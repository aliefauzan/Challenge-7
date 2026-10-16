// Styles for the injected UI. They live inside the closed shadow root, so
// the page's CSS cannot reach them and they cannot leak onto the page.
// Sizes are large on purpose: the main readers are older adults.

export const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.tm-banner, .tm-blocker {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 18px;
  line-height: 1.45;
  color: #1a1a1a;
  text-align: left;
  letter-spacing: normal;
}
.tm-banner {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: min(640px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow: auto;
  z-index: 2147483647;
  background: #fff;
  border-radius: 12px;
  border-left: 10px solid #b26a00;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
  padding: 18px 20px 16px;
}
.tm-banner.tm-red { border-left-color: #c62828; }
.tm-banner.tm-amber { border-left-color: #b26a00; }
.tm-banner.tm-bias { border-left-color: #546e7a; }
.tm-head { display: flex; align-items: flex-start; gap: 12px; }
.tm-title { flex: 1; margin: 0; font-size: 22px; font-weight: 700; }
.tm-red .tm-title { color: #b71c1c; }
.tm-amber .tm-title { color: #8a5300; }
.tm-close {
  flex: none;
  font: inherit;
  font-size: 26px;
  line-height: 1;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #444;
  cursor: pointer;
}
.tm-close:hover { background: #eee; }
.tm-reasons { margin: 10px 0 0; padding-left: 22px; }
.tm-reason { margin: 4px 0; font-weight: 600; }
.tm-family { margin: 12px 0 0; padding: 10px 12px; border-radius: 8px; background: #fff4e5; font-weight: 600; }
.tm-red .tm-family { background: #fdecea; }
.tm-actions { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin-top: 12px; }
.tm-link, .tm-disclose {
  font: inherit;
  font-size: 17px;
  color: #0b57d0;
  text-decoration: underline;
  background: none;
  border: 0;
  padding: 6px 0;
  cursor: pointer;
}
.tm-why { margin: 8px 0 0; padding: 0; list-style: none; }
.tm-why li { margin: 6px 0; }
.tm-why b { display: block; }
.tm-meta { margin: 6px 0 0; color: #333; }
.tm-blocker {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  background: #7f0000;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: auto;
}
.tm-panel {
  width: min(680px, 100%);
  background: #fff;
  color: #1a1a1a;
  border-radius: 16px;
  padding: 28px 28px 24px;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
}
.tm-panel h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.2; color: #b71c1c; }
.tm-panel h1:focus { outline: none; } /* focused by script, not reachable by Tab */
.tm-domain { margin: 0 0 12px; font-size: 18px; word-break: break-all; }
.tm-domain b { font-weight: 700; }
.tm-buttons { display: flex; flex-wrap: wrap; gap: 14px 20px; align-items: center; margin-top: 20px; }
.tm-primary {
  font: inherit;
  font-size: 20px;
  font-weight: 700;
  min-height: 52px;
  padding: 12px 26px;
  border: 0;
  border-radius: 10px;
  background: #1b5e20;
  color: #fff;
  cursor: pointer;
}
.tm-risk {
  font: inherit;
  font-size: 16px;
  color: #555;
  text-decoration: underline;
  background: none;
  border: 0;
  padding: 8px 0;
  cursor: pointer;
}
button:focus-visible, a:focus-visible { outline: 3px solid #0b57d0; outline-offset: 3px; }
@media (prefers-color-scheme: dark) {
  .tm-banner, .tm-panel { background: #1e1e1e; color: #f1f1f1; }
  .tm-family { background: #3a2a10; }
  .tm-red .tm-family { background: #3d1515; }
  .tm-red .tm-title, .tm-panel h1 { color: #ff8a80; }
  .tm-amber .tm-title { color: #ffcc80; }
  .tm-link, .tm-disclose { color: #8ab4f8; }
  .tm-meta, .tm-risk, .tm-close { color: #ccc; }
  .tm-close:hover { background: #333; }
}
@media (prefers-reduced-motion: no-preference) {
  .tm-banner { animation: tm-in 160ms ease-out; }
  @keyframes tm-in { from { opacity: 0; transform: translate(-50%, -8px); } to { opacity: 1; transform: translate(-50%, 0); } }
}
`;
