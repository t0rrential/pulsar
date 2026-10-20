import { useEffect, useMemo, useState } from "react";

interface Request<T> {
  promise?: Promise<T | null>;
}

type Resource<T> =
  | { status: "loading" }
  | { status: "success"; data: T | null }
  | { status: "error"; error: Error };

interface Result<T> {
  request: Request<T>;
  resource: Resource<T>;
}

async function fetchJson<T>(url: string, allowNoContent: boolean): Promise<T | null> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (allowNoContent && response.status === 204) return null;
  if (!response.ok) throw new Error(`The API returned HTTP ${response.status}.`);
  return response.json();
}

export function useJsonResource<T>(
  url: string,
  refreshKey?: string | number,
  allowNoContent = false,
): Resource<T> {
  // Every mounted consumer owns its request. StrictMode effect replay reuses
  // this promise, but always subscribes again after cleanup. Changed inputs
  // create a new record; no global cache can survive a genuine slot remount.
  const request = useMemo<Request<T>>(() => ({}), [url, refreshKey, allowNoContent]);
  const [result, setResult] = useState<Result<T> | null>(null);

  useEffect(() => {
    let subscribed = true;
    request.promise ??= fetchJson<T>(url, allowNoContent);
    void request.promise.then(
      (data) => {
        if (subscribed) setResult({ request, resource: { status: "success", data } });
      },
      (cause: unknown) => {
        if (subscribed) {
          const error = cause instanceof Error ? cause : new Error("The API request failed.");
          setResult({ request, resource: { status: "error", error } });
        }
      },
    );
    return () => {
      subscribed = false;
    };
  }, [request, url, allowNoContent]);

  // Hide the previous input's result immediately, before passive cleanup runs.
  return result?.request === request ? result.resource : { status: "loading" };
}
