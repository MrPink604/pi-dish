interface TakeoverPolicy {
  close: () => void;
  clearsSessionSurfaces?: true;
}
interface SessionSurfacePolicy {
  close: () => void;
  closeOnTakeover?: true;
}

/** Exclusion only: controllers still own opening, retirement and disposal. */
export function createMainPane<Takeover extends string>(policies: {
  takeovers: Record<Takeover, TakeoverPolicy>;
  sessionSurfaces: Readonly<Record<string, SessionSurfacePolicy>>;
  overlays: {
    settings: () => void;
    sidebar: () => void;
    session: Readonly<Record<string, () => void>>;
    bounce: () => void;
  };
}) {
  // Enumerate registrations once, not on each transition. No active-view mirror.
  const takeovers = Object.values<TakeoverPolicy>(policies.takeovers);
  const surfaces = Object.values(policies.sessionSurfaces);
  const sessionOverlays = Object.values(policies.overlays.session);
  const overlays = policies.overlays;

  return {
    beforeTakeover(name: Takeover): void {
      const entering = policies.takeovers[name];
      if (entering.clearsSessionSurfaces) overlays.settings();
      overlays.sidebar();
      for (const takeover of takeovers) if (takeover !== entering) takeover.close();
      overlays.bounce();
      if (entering.clearsSessionSurfaces) {
        for (const surface of surfaces) if (surface.closeOnTakeover) surface.close();
      }
    },
    beforeSelection(keepBounce: boolean): void {
      for (const surface of surfaces) surface.close();
      for (const close of sessionOverlays) close();
      for (const takeover of takeovers) takeover.close();
      if (!keepBounce) overlays.bounce();
    },
  };
}
