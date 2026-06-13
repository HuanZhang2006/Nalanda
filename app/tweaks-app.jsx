/* ============================================================
   Nalanda — Tweaks island. Mounts the host-protocol Tweaks panel
   and applies values to the vanilla app via CSS variables / attrs.
   ============================================================ */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": ["#9c6a39", "#b6814d", "#fffdf8"],
  "fontPair": "editorial",
  "density": "Comfortable",
  "sidebar": "Expanded"
}/*EDITMODE-END*/;

const FONT_PAIRS = {
  editorial: { serif: '"Newsreader", Georgia, serif', sans: '"Public Sans", system-ui, sans-serif', label: "Newsreader + Public Sans" },
  academic:  { serif: '"Spectral", Georgia, serif',  sans: '"IBM Plex Sans", system-ui, sans-serif', label: "Spectral + IBM Plex Sans" },
  classic:   { serif: '"Source Serif 4", Georgia, serif', sans: '"Inter Tight", system-ui, sans-serif', label: "Source Serif 4 + Inter Tight" },
};

function applyTweaks(t){
  const root = document.documentElement;
  // accent (theme-aware: lighten on dark backgrounds)
  const [main, light, on] = t.accent;
  const dark = root.getAttribute("data-theme") === "dark";
  if(dark){
    root.style.setProperty("--accent", `color-mix(in srgb, ${main} 72%, white)`);
    root.style.setProperty("--accent-2", `color-mix(in srgb, ${main} 50%, white)`);
    root.style.setProperty("--on-accent", "#241c10");
  } else {
    root.style.setProperty("--accent", main);
    root.style.setProperty("--accent-2", light);
    root.style.setProperty("--on-accent", on);
  }
  // fonts
  const fp = FONT_PAIRS[t.fontPair] || FONT_PAIRS.editorial;
  root.style.setProperty("--font-serif", fp.serif);
  root.style.setProperty("--font-sans", fp.sans);
  // density
  if(t.density === "Compact"){ root.style.setProperty("--u",".82"); root.style.setProperty("--fs",".94"); }
  else { root.style.setProperty("--u","1"); root.style.setProperty("--fs","1"); }
  // sidebar
  const rail = t.sidebar === "Icon rail";
  root.setAttribute("data-rail", rail ? "1" : "0");
  if(window.S) window.S.rail = rail;
}

function TweaksApp(){
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  React.useEffect(()=>{ applyTweaks(t); }, [t]);
  // re-apply accent when the app's own light/dark toggle flips
  React.useEffect(()=>{
    const obs = new MutationObserver(()=>applyTweaks(t));
    obs.observe(document.documentElement, { attributes:true, attributeFilter:["data-theme"] });
    return ()=>obs.disconnect();
  }, [t]);

  return React.createElement(TweaksPanel, { title: "Tweaks" },
    React.createElement(TweakSection, { label: "Appearance" }),
    React.createElement(TweakColor, {
      label: "Accent", value: t.accent,
      options: [["#9c6a39","#b6814d","#fffdf8"], ["#bd5a40","#d2785d","#fff7f3"],
                ["#3f7d5f","#5d9b7b","#f4faf6"], ["#4f5fb0","#6f7fc8","#f6f7fd"]],
      onChange: v => setTweak("accent", v) }),
    React.createElement(TweakSelect, {
      label: "Font pairing", value: t.fontPair,
      options: Object.keys(FONT_PAIRS).map(k => ({ value:k, label: FONT_PAIRS[k].label })),
      onChange: v => setTweak("fontPair", v) }),
    React.createElement(TweakSection, { label: "Layout" }),
    React.createElement(TweakRadio, {
      label: "Density", value: t.density, options: ["Comfortable","Compact"],
      onChange: v => setTweak("density", v) }),
    React.createElement(TweakRadio, {
      label: "Sidebar", value: t.sidebar, options: ["Expanded","Icon rail"],
      onChange: v => setTweak("sidebar", v) }),
  );
}

// apply defaults immediately (before panel ever opens) so the first paint is right
applyTweaks(TWEAK_DEFAULTS);
ReactDOM.createRoot(document.getElementById("tweaks-root")).render(React.createElement(TweaksApp));
