import { Suspense, useEffect, useState } from 'react';
import { useSolidFetch, useWebId } from '@jeswr/solid-reactive-fetch-react';

const PRIVATE_RESOURCE_URL = 'http://localhost:3000/alice/private.txt';

type StatusKind = 'idle' | 'loading' | 'ok' | 'error';

function WebIdBadge() {
  const webId = useWebId();
  return (
    <p>
      Signed in as: <code data-testid="webid-display">{webId}</code>
    </p>
  );
}

function ShowWebIdSection() {
  const [revealed, setRevealed] = useState(false);
  return (
    <>
      <button
        type="button"
        data-testid="show-webid"
        onClick={() => setRevealed(true)}
      >
        Show my WebID
      </button>
      {revealed ? (
        <Suspense fallback={<p className="status">Signing in…</p>}>
          <WebIdBadge />
        </Suspense>
      ) : null}
    </>
  );
}

function FetchPrivateSection() {
  const solidFetch = useSolidFetch();
  const [status, setStatus] = useState<{ text: string; kind: StatusKind }>({
    text: 'Idle.',
    kind: 'idle',
  });
  const [body, setBody] = useState<string>('(no output yet)');
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    setBusy(true);
    setStatus({ text: `Fetching ${PRIVATE_RESOURCE_URL}…`, kind: 'loading' });
    try {
      const response = await solidFetch(PRIVATE_RESOURCE_URL);
      const text = await response.text();
      setStatus({
        text: `${response.status} ${response.statusText} — ${PRIVATE_RESOURCE_URL}`,
        kind: response.ok ? 'ok' : 'error',
      });
      setBody(text || '(empty body)');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ text: message, kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-testid="fetch-private"
        onClick={onClick}
        disabled={busy}
      >
        Fetch private resource from my pod
      </button>
      <div className="status" data-testid="status" data-status={status.kind}>
        {status.text}
      </div>
      <pre data-testid="result">{body}</pre>
    </>
  );
}

export function App() {
  // Hydration marker: once `<App />` has mounted, the provider is live and
  // the hooks are ready to be used. Gives Playwright (and any harness) a
  // deterministic signal on `[data-testid="ready"]` without timers.
  useEffect(() => {
    document.body.dataset.testid = 'ready';
    return () => {
      delete document.body.dataset.testid;
    };
  }, []);

  return (
    <>
      <h1>reactive-fetch React example</h1>
      <p>
        This app uses <code>@jeswr/solid-reactive-fetch-react</code>. The first
        interaction opens a popup where you enter your WebID and sign in;
        subsequent interactions reuse the restored session.
      </p>
      <ShowWebIdSection />
      <FetchPrivateSection />
    </>
  );
}
