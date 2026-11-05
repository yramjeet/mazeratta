export default function Welcome() {
  return (
    <section className="panel">
      <div className="heading">
        <img className="logo" src="/mz_icon.png" alt="Mazeratta" />
        <h1 className="title">Build this from the UI</h1>
      </div>

      <ol className="steps">
        <li>
          Hover this panel — a pencil <span className="key">✎</span> appears at its corner.
        </li>
        <li>Click it. The popover opens at your pointer with two options.</li>
        <li>
          <strong>Note</strong> — describe what you want, press <span className="key">Enter</span>.
          It reaches your agent with this file attached.
        </li>
        <li>
          <strong>Granularity</strong> — <span className="key">+</span> asks the agent to give
          this panel's children their own crumbs, so you can point at smaller pieces.{" "}
          <span className="key">−</span> asks it to remove them.
        </li>
      </ol>

      <p className="hint">
        Nothing changes on screen when you send — the note goes to your agent, and the UI
        follows once it has edited the code.
      </p>

      <p className="hint">
        Try: <em>"replace this panel with a sign-in form — email, password, submit"</em>
      </p>
    </section>
  );
}
