package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"mazeratta/server/claude"
)

func main() {
	addr := flag.String("addr", ":8080", "Address to listen on (with -channel or -submit: 127.0.0.1:8080, loopback only)")
	tmuxSession := flag.String("tmux", "mazeratta", "Initial session: the tmux session to forward notes to (with -channel the default is "+claude.Session+")")
	useClaudeChannel := flag.Bool("channel", false, "Run as a Claude Code channel (MCP on stdio); adds the "+claude.Session+" session")
	submit := flag.Bool("submit", false, "Press Enter after typing a note into tmux, so it runs without review; binds loopback only and checks origins, as -channel does")
	var origins originList
	flag.Var(&origins, "origin", "With -channel or -submit: an extra allowed browser origin, exact (repeatable); localhost origins are always allowed")
	flag.Parse()
	set := map[string]bool{}
	flag.Visit(func(f *flag.Flag) { set[f.Name] = true })

	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))

	srv := &server{session: *tmuxSession, submit: *submit}
	localOnly := *useClaudeChannel || *submit

	if localOnly {
		if !set["addr"] {
			*addr = "127.0.0.1:8080"
		}
		if !isLoopbackAddr(*addr) {
			slog.Error("Refused non-loopback address: -channel and -submit listen on loopback only", "value", *addr)
			os.Exit(2)
		}
	}
	if *useClaudeChannel {
		srv.channel = claude.NewChannel(os.Stdout)
		if !set["tmux"] {
			srv.session = claude.Session
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/note", srv.handleNote)
	mux.HandleFunc("GET /api/session", srv.handleGetSession)
	mux.HandleFunc("POST /api/session", srv.handleSetSession)

	if !localOnly {
		slog.Info("Starting HTTP server",
			"args", map[string]any{"addr": *addr, "tmux": *tmuxSession})
		if err := checkPortFree(*addr); err != nil {
			slog.Error("Note port busy", "error", err, "addr", *addr)
			os.Exit(1)
		}
		if err := http.ListenAndServe(*addr, withCORS(mux, nil)); err != nil {
			slog.Error("HTTP server stopped", "error", err)
			os.Exit(1)
		}
		return
	}

	allowed := origins.allow
	handler := requireLoopbackHost(withCORS(mux, allowed))
	listeners, err := listenLoopback(*addr)
	if err != nil {
		if srv.channel == nil {
			slog.Error("Note port busy", "error", err, "addr", *addr)
			os.Exit(1)
		}
		slog.Warn("Note port busy; this session receives no notes", "error", err, "addr", *addr)
	}
	stopped := make(chan error, len(listeners))
	for _, ln := range listeners {
		slog.Info("Listening for notes",
			"call", "net.Listen", "args", map[string]any{"addr": *addr, "tmux": srv.session, "submit": srv.submit}, "value", ln.Addr().String())
		go func() {
			err := http.Serve(ln, handler)
			slog.Error("HTTP server stopped", "error", err)
			stopped <- err
		}()
	}
	if srv.channel == nil {
		<-stopped
		os.Exit(1)
	}
	if err := srv.channel.Serve(os.Stdin); err != nil {
		slog.Error("Channel stream failed", "error", err)
		os.Exit(1)
	}
	slog.Info("Claude Code closed the channel")
}

type server struct {
	session string
	submit  bool
	channel *claude.Channel
}

func (s *server) listSessions() []string {
	var out []string
	if s.channel != nil {
		out = append(out, claude.Session)
	}
	out = append(out, tmuxSessions()...)
	return out
}

type sessionRequest struct {
	Session string `json:"session"`
}

func (s *server) writeSessionJSON(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]any{"session": s.session, "sessions": s.listSessions()}); err != nil {
		slog.Error("Failed to encode session response", "error", err)
	}
}

func (s *server) handleGetSession(w http.ResponseWriter, r *http.Request) {
	slog.Info("Served session", "value", s.session)
	s.writeSessionJSON(w)
}

func (s *server) handleSetSession(w http.ResponseWriter, r *http.Request) {
	var req sessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Error("Failed to decode session request", "error", err)
		httpError(w, http.StatusBadRequest, "Invalid JSON body: "+err.Error())
		return
	}
	name := strings.TrimSpace(req.Session)
	if name == "" {
		slog.Warn("Rejected empty session")
		httpError(w, http.StatusBadRequest, "Session must not be empty")
		return
	}
	if name == claude.Session && s.channel == nil {
		slog.Warn("Rejected channel session without channel", "value", name)
		httpError(w, http.StatusBadRequest, "This server was not started by Claude Code with -channel")
		return
	}
	s.session = name
	slog.Info("Updated session", "value", name)
	s.writeSessionJSON(w)
}

type noteRequest struct {
	File          string `json:"file"`
	Functionality string `json:"functionality"`
	Text          string `json:"text"`
}

func composeNote(req noteRequest) string {
	prefix := "crumb"
	if file := flattenWhitespace(req.File); file != "" {
		prefix += " @ " + file
	}
	if req.Functionality != "" {
		prefix += " (" + flattenWhitespace(req.Functionality) + ")"
	}
	return prefix + ": " + flattenWhitespace(req.Text)
}

func (s *server) handleNote(w http.ResponseWriter, r *http.Request) {
	slog.Info("Handling note request",
		"args", map[string]any{"remote": r.RemoteAddr})

	var req noteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		slog.Error("Failed to decode note request", "error", err)
		httpError(w, http.StatusBadRequest, "Invalid JSON body: "+err.Error())
		return
	}
	slog.Info("Received note",
		"value", map[string]any{
			"file":          req.File,
			"functionality": req.Functionality, "text": req.Text,
		})

	payload := composeNote(req)

	session := s.session
	if session == claude.Session && s.channel != nil {
		if err := s.channel.PushNote(payload, claude.Meta{
			File:          flattenWhitespace(req.File),
			Functionality: flattenWhitespace(req.Functionality),
		}); err != nil {
			slog.Error("Failed to push note to channel", "error", err)
			httpError(w, http.StatusServiceUnavailable, "Failed to push to the Claude Code channel: "+err.Error())
			return
		}
		slog.Info("Pushed note to channel",
			"value", map[string]any{"file": req.File})
	} else {
		if err := typeIntoTmux(session, payload, s.submit); err != nil {
			slog.Error("Failed to forward note to tmux",
				"error", err, "session", session)
			httpError(w, http.StatusBadGateway, "Failed to forward to tmux: "+err.Error())
			return
		}
		slog.Info("Forwarded note to tmux session",
			"value", map[string]any{"session": session, "file": req.File, "submitted": s.submit})
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(map[string]any{
		"ok":      true,
		"session": session,
		"note":    payload,
	}); err != nil {
		slog.Error("Failed to encode note response", "error", err)
	}
}

func tmuxSessions() []string {
	out, err := exec.Command("tmux", "list-sessions", "-F", "#{session_name}").Output()
	if err != nil {
		return nil
	}
	var names []string
	for _, n := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if n != "" {
			names = append(names, n)
		}
	}
	return names
}

func flattenWhitespace(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

func typeIntoTmux(session, text string, submit bool) error {
	if err := runTmux("send-keys", "-t", session, "-l", "--", text); err != nil {
		return err
	}
	if !submit {
		return nil
	}
	time.Sleep(submitDelay)
	return runTmux("send-keys", "-t", session, "Enter")
}

const submitDelay = 100 * time.Millisecond

func runTmux(args ...string) error {
	if out, err := exec.Command("tmux", args...).CombinedOutput(); err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}

func httpError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func withCORS(next http.Handler, allow func(string) bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if allow == nil {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else if origin := r.Header.Get("Origin"); origin != "" {
			if !allow(origin) {
				slog.Warn("Rejected request from disallowed origin", "value", origin)
				httpError(w, http.StatusForbidden, "Origin not allowed: "+origin)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type originList []string

func (o *originList) String() string { return strings.Join(*o, ",") }

func (o *originList) Set(v string) error {
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" {
		return fmt.Errorf("origin must be scheme://host[:port], got %q", v)
	}
	*o = append(*o, v)
	return nil
}

func (o originList) allow(origin string) bool {
	for _, v := range o {
		if v == origin {
			return true
		}
	}
	u, err := url.Parse(origin)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Path == "" && isLoopbackHost(u.Hostname())
}

func isLoopbackHost(h string) bool {
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func isLoopbackAddr(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	return err == nil && isLoopbackHost(host)
}

func loopbackListenAddrs(addr string) []string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return []string{addr}
	}
	switch host {
	case "localhost", "127.0.0.1", "::1":
		return []string{net.JoinHostPort("127.0.0.1", port), net.JoinHostPort("::1", port)}
	}
	return []string{addr}
}

func checkPortFree(addr string) error {
	targets := loopbackListenAddrs(addr)
	if host, port, err := net.SplitHostPort(addr); err == nil && (host == "" || host == "0.0.0.0" || host == "::") {
		targets = loopbackListenAddrs(net.JoinHostPort("127.0.0.1", port))
	}
	for _, t := range targets {
		if c, err := net.DialTimeout("tcp", t, 300*time.Millisecond); err == nil {
			c.Close()
			return fmt.Errorf("another server already answers on %s", t)
		}
	}
	return nil
}

func listenLoopback(addr string) ([]net.Listener, error) {
	if err := checkPortFree(addr); err != nil {
		return nil, err
	}
	targets := loopbackListenAddrs(addr)
	var listeners []net.Listener
	for i, t := range targets {
		ln, err := net.Listen("tcp", t)
		if err == nil {
			listeners = append(listeners, ln)
			continue
		}
		if i > 0 && !errors.Is(err, syscall.EADDRINUSE) {
			continue
		}
		for _, l := range listeners {
			l.Close()
		}
		return nil, err
	}
	return listeners, nil
}

func requireLoopbackHost(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(r.Host); err == nil {
			host = h
		}
		if !isLoopbackHost(host) {
			slog.Warn("Rejected non-local host header", "value", r.Host)
			httpError(w, http.StatusForbidden, "Host not allowed: "+r.Host)
			return
		}
		next.ServeHTTP(w, r)
	})
}
