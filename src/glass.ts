// "Liquid glass" look for every button of every MODit window (Settings > Appearance > Liquid glass buttons).
// Injected as CSS by themes.ts after the theme's own layer, so it works with every theme and needs no change to the pages.

const BTN = [
  'html button', 'html .btn', 'html .ib', 'html .g',
].join(',');
const SIDE = 'html .nav,html .game'; // sidebar entries: glass only while selected / hovered, so the list stays calm

const GLASS = `
${BTN}{
  background:linear-gradient(150deg,rgba(255,255,255,.26) 0%,rgba(255,255,255,.07) 42%,rgba(255,255,255,.04) 58%,rgba(255,255,255,.18) 100%)!important;
  -webkit-backdrop-filter:blur(14px) saturate(190%) brightness(1.1);backdrop-filter:blur(14px) saturate(190%) brightness(1.1);
  border:1px solid rgba(255,255,255,.30)!important;
  box-shadow:inset 0 1.5px 0 rgba(255,255,255,.6),inset 0 -1.5px 0 rgba(255,255,255,.12),inset 1px 0 0 rgba(255,255,255,.18),inset -1px 0 0 rgba(255,255,255,.1),inset 0 0 16px rgba(255,255,255,.08),0 6px 18px rgba(0,0,0,.3)!important;
  text-shadow:0 1px 2px rgba(0,0,0,.28);
  transition:transform .28s cubic-bezier(.2,.9,.3,1.5),box-shadow .25s,background .25s,border-color .25s!important;
}
html .btn:not(.ghost):not(.danger){
  background:linear-gradient(150deg,color-mix(in srgb,var(--t-a,#b3363c) 78%,rgba(255,255,255,.35)) 0%,color-mix(in srgb,var(--t-a,#b3363c) 42%,transparent) 48%,color-mix(in srgb,var(--t-b,#4a6fd8) 55%,transparent) 100%)!important;
  border-color:rgba(255,255,255,.38)!important;
}
html .btn.danger{
  background:linear-gradient(150deg,rgba(255,110,110,.8) 0%,rgba(200,40,50,.45) 50%,rgba(255,90,90,.6) 100%)!important;
}
${BTN}:hover{
  background:linear-gradient(150deg,rgba(255,255,255,.38) 0%,rgba(255,255,255,.12) 42%,rgba(255,255,255,.08) 58%,rgba(255,255,255,.26) 100%)!important;
  transform:translateY(-1px) scale(1.035);
  box-shadow:inset 0 1.5px 0 rgba(255,255,255,.75),inset 0 -1.5px 0 rgba(255,255,255,.16),inset 0 0 20px rgba(255,255,255,.14),0 10px 26px rgba(0,0,0,.34)!important;
}
html .btn:not(.ghost):not(.danger):hover{
  background:linear-gradient(150deg,color-mix(in srgb,var(--t-a,#b3363c) 88%,rgba(255,255,255,.45)) 0%,color-mix(in srgb,var(--t-a,#b3363c) 55%,transparent) 48%,color-mix(in srgb,var(--t-b,#4a6fd8) 70%,transparent) 100%)!important;
}
${BTN}:active{transform:scale(.96);transition-duration:.08s!important}

${SIDE}{border:1px solid transparent;transition:transform .28s cubic-bezier(.2,.9,.3,1.5),background .25s,box-shadow .25s,border-color .25s}
html .nav.on,html .game.on,html .game.sel,html .game.active,${SIDE.split(',').map(s => s + ':hover').join(',')}{
  background:linear-gradient(150deg,rgba(255,255,255,.22) 0%,rgba(255,255,255,.06) 45%,rgba(255,255,255,.14) 100%)!important;
  -webkit-backdrop-filter:blur(14px) saturate(190%) brightness(1.1);backdrop-filter:blur(14px) saturate(190%) brightness(1.1);
  border-color:rgba(255,255,255,.28)!important;
  box-shadow:inset 0 1.5px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(255,255,255,.1),0 4px 14px rgba(0,0,0,.22)!important;
}
`;

/** The CSS to inject into one kind of page (same for all of them; `page` is kept so a page can be treated differently later). */
export function glassLayer(_page: string): string {
  return GLASS;
}
