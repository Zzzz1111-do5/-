import { useEffect, useRef } from "react";

/** 立即执行一次并按间隔轮询；页面不可见时暂停。依赖变化时重新开始。 */
export function usePolling(fn: (signal: { cancelled: boolean }) => void | Promise<void>, deps: unknown[], intervalMs: number) {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const token = { cancelled: false };
    let timer: number | undefined;
    const tick = async () => {
      if (token.cancelled) return;
      if (document.visibilityState !== "hidden") {
        try {
          await fnRef.current(token);
        } catch {
          // 由调用方处理错误
        }
      }
      if (!token.cancelled) timer = window.setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      token.cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs]);
}
