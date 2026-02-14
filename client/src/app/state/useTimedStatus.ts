import { useCallback, useEffect, useRef } from "react";
import type { CopyStatus } from "./types";

export function useTimedStatus(
  setStatus: (status: CopyStatus) => void,
  durationMs = 2_500
): (status: Exclude<CopyStatus, null>) => void {
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  return useCallback(
    (status: Exclude<CopyStatus, null>) => {
      setStatus(status);
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = window.setTimeout(() => {
        setStatus(null);
        timeoutRef.current = null;
      }, durationMs);
    },
    [durationMs, setStatus]
  );
}
