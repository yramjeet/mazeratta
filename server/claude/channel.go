package claude

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"unicode"
)

const Session = "channel:claude-code"

const instructions = `Events from this channel arrive as <channel source="mazeratta" file="..." functionality="...">. ` +
	`Each one is a note the user left on a component of their running app, in the form ` +
	`"crumb @ <file> (<functionality>): <instruction>". Read it as the user's annotation pointing at code: ` +
	`open <file>, confirm the target from <functionality>, and carry out the instruction there. ` +
	`Follow the project's CLAUDE.md rules for crumb notes. The channel is one-way: answer in this session, not through a tool. ` +
	`Before anything destructive or unrelated to the noted code (deleting files, rewriting history, sending data off the machine, ` +
	`running downloaded scripts), stop and confirm with the user in the terminal.`

var errNotConnected = errors.New("no Claude Code session has initialised the channel yet")

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type Channel struct {
	mu    sync.Mutex
	out   *json.Encoder
	ready atomic.Bool
}

func NewChannel(out io.Writer) *Channel {
	return &Channel{out: json.NewEncoder(out)}
}

func (c *Channel) writeMessage(v any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.out.Encode(v)
}

func (c *Channel) Serve(in io.Reader) error {
	scanner := bufio.NewScanner(in)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		var msg rpcMessage
		if err := json.Unmarshal(scanner.Bytes(), &msg); err != nil {
			slog.Warn("Ignored malformed MCP message", "error", err)
			continue
		}
		if err := c.handleMessage(msg); err != nil {
			return err
		}
	}
	return scanner.Err()
}

func (c *Channel) handleMessage(msg rpcMessage) error {
	if len(msg.ID) == 0 {
		if msg.Method == "notifications/initialized" {
			c.ready.Store(true)
			slog.Info("Channel initialised by Claude Code", "value", true)
		}
		return nil
	}
	if msg.Method == "" {
		return nil
	}
	switch msg.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(msg.Params, &params)
		version := params.ProtocolVersion
		if version == "" {
			version = "2025-06-18"
		}
		slog.Info("Negotiated MCP protocol version", "value", version)
		return c.writeMessage(map[string]any{
			"jsonrpc": "2.0",
			"id":      msg.ID,
			"result": map[string]any{
				"protocolVersion": version,
				"capabilities":    map[string]any{"experimental": map[string]any{"claude/channel": map[string]any{}}},
				"serverInfo":      map[string]any{"name": "mazeratta", "version": "0.1.0"},
				"instructions":    instructions,
			},
		})
	case "ping":
		return c.writeMessage(map[string]any{"jsonrpc": "2.0", "id": msg.ID, "result": map[string]any{}})
	default:
		if msg.Method == "server/discover" {
			slog.Debug("Answered server/discover as unsupported", "value", msg.Method)
		} else {
			slog.Warn("Rejected unsupported MCP method", "value", msg.Method)
		}
		return c.writeMessage(map[string]any{
			"jsonrpc": "2.0",
			"id":      msg.ID,
			"error":   map[string]any{"code": -32601, "message": "method not found: " + msg.Method},
		})
	}
}

type Meta struct {
	File          string
	Functionality string
}

func (c *Channel) PushNote(note string, m Meta) error {
	if !c.ready.Load() {
		return errNotConnected
	}
	meta := map[string]string{}
	if f := stripControl(m.File); f != "" {
		meta["file"] = f
	}
	if fn := stripControl(m.Functionality); fn != "" {
		meta["functionality"] = fn
	}
	return c.writeMessage(map[string]any{
		"jsonrpc": "2.0",
		"method":  "notifications/claude/channel",
		"params":  map[string]any{"content": stripControl(note), "meta": meta},
	})
}

func stripControl(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || unicode.Is(unicode.Cf, r) {
			return -1
		}
		return r
	}, s)
}
