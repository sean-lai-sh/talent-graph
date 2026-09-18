"use client";

import { useEffect, useRef, useState } from "react";

type ChipViewerHandle = {
  destroy: () => void;
};

type ChipModule = {
  mountNyuChip: (
    container: HTMLElement,
    options: { autoRotate: boolean; interactionTarget: HTMLElement },
  ) => ChipViewerHandle;
};

/**
 * Mounts the pope-cruz/chips Three.js viewer from the static module.
 * Dynamic import keeps the 426kb bundle out of the Next graph.
 */
export function ChipViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    let viewer: ChipViewerHandle | undefined;

    const url = new URL("/chips/nyu-chip.js", window.location.origin).href;
    void import(/* webpackIgnore: true */ url)
      .then((mod: ChipModule) => {
        if (cancelled || !containerRef.current) return;
        const main = container.closest("main");
        viewer = mod.mountNyuChip(container, {
          autoRotate: true,
          interactionTarget: main instanceof HTMLElement ? main : container,
        });
        const canvas = container.querySelector("canvas");
        if (canvas instanceof HTMLElement) canvas.style.cursor = "inherit";
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      viewer?.destroy();
    };
  }, []);

  if (failed) {
    return (
      <p id="status" role="status">
        The chip couldn’t load. Please refresh to try again.
      </p>
    );
  }

  return <div id="chip" ref={containerRef} />;
}
