// The part of a theme that knows MODit's markup: one CSS layer per kind of window, written only with the
// --t-* tokens from themes.ts. It is injected AFTER the page's own CSS, so each rule starts with `html`
// to win over the page's selectors without !important (the few places where the page itself uses
// !important are repeated here). "glass" gets none of this: it is simply the page's own CSS.

export type Page = 'main' | 'browser' | 'newtab' | 'menu' | 'dlpanel' | 'picker';

const MAIN = `
html body{background:var(--t-bg)}
.orb{display:none!important}
html aside{background:var(--t-panel);backdrop-filter:none;-webkit-backdrop-filter:none;border-color:var(--t-line)}
html header{background:var(--t-panel);backdrop-filter:none;-webkit-backdrop-filter:none;border-color:var(--t-line);border-bottom:1px solid var(--t-line)}
html .brand span{background:linear-gradient(90deg,var(--t-a),var(--t-b));-webkit-background-clip:text;background-clip:text;color:transparent}

html .card,html .game,html .box{background:var(--t-card);backdrop-filter:none;-webkit-backdrop-filter:none;border:1px solid var(--t-line)}
html .card:hover{border-color:var(--t-line2)}
html .card.site:hover{border-color:var(--t-a);background:var(--t-hover)}
html .game:hover{background:var(--t-hover)}
html .thumb{background:var(--t-thumb)}
html .gcard .thumb .ph{color:var(--mut)}
html .rm{color:#fff}
html .dot{background:linear-gradient(135deg,var(--t-a),var(--t-a-deep));color:var(--t-on-a)}
html .dot.has{background:var(--t-hover)}
html .ico{background:var(--t-thumb);border:1px solid var(--t-line2)}
html .ico.has{background:#fff;border-color:var(--t-line2)}

html .nav:hover{background:var(--t-hover);color:var(--tx)}
html .nav.on{background:var(--t-a-soft);color:var(--t-a-text)}

html .btn{background:var(--t-a);border:2px solid var(--t-a);color:var(--t-on-a);backdrop-filter:none;-webkit-backdrop-filter:none}
html .btn:hover{background:var(--t-a-hover);border-color:var(--t-a-hover);box-shadow:none}
html .btn.ghost{background:var(--t-card);border:2px solid var(--t-line2);color:var(--tx)}
html .btn.ghost:hover{background:var(--t-hover);border-color:var(--t-line2)}
html .btn.danger,html .btn.danger:hover{background:var(--t-danger);border-color:var(--t-danger);color:#fff}
html .btn.danger:hover{filter:brightness(1.1)}
html #askNo,html #askNo:hover{background:var(--t-hover)!important;border:2px solid var(--t-line)!important;color:var(--mut);box-shadow:none}
html #askNo:hover{background:var(--t-line)!important;color:var(--tx)}

html .pill{background:var(--t-pill)}
html .pill::after{background:var(--t-knob)}
html .pill.on{background:var(--t-a)}
html .pill.on::after{background:#fff}

html .ddMenu,html .profline .ddMenu{background:var(--t-menu);backdrop-filter:none;-webkit-backdrop-filter:none;border:1px solid var(--t-line2);box-shadow:var(--t-shadow)}
html .ddi:hover{background:var(--t-hover)}
html .ddi.on{background:var(--t-a-soft);color:var(--t-a-text)}
html .ctx{background:var(--t-menu);backdrop-filter:none;-webkit-backdrop-filter:none;border:1px solid var(--t-line2);box-shadow:var(--t-shadow)}
html .ctx button:hover{background:var(--t-hover)}
html .ctx hr{background:var(--t-line)}
html .ctx .danger{color:var(--t-danger-tx)}
html .ctx .danger:hover{background:var(--t-danger-soft)}
html .toast,html .busy{background:var(--t-menu);border:1px solid var(--t-line2);color:var(--tx)}
html .busy i{border:2px solid var(--t-line2);border-top-color:var(--t-a)}

html select,html .bar input,html .ddnew input,html .gform input,html .box input,html .scard input:not([type=checkbox]){background:var(--t-input);border:1px solid var(--t-line2);color:var(--tx)}
html select:focus,html .bar input:focus,html .ddnew input:focus,html .gform input:focus,html .box input:focus,html .scard input:not([type=checkbox]):focus{border-color:var(--t-a)}
html .chkrow input,html .skip input{accent-color:var(--t-a)}
html .chk{border:2px solid var(--t-line2);color:var(--t-on-a)}
html .item:hover{background:var(--t-hover)}

html .modal,html .drop,html .gm{background:var(--t-scrim)}
html .gbox{background:var(--t-card);border:1px solid var(--t-line)}
html .tag{background:var(--t-b-soft);border:1px solid var(--t-b-line);color:var(--t-b-text)}
html .box .tagc{background:var(--t-hover);border:1px solid var(--t-line);color:var(--mut)}

html .dl{background:var(--t-card);border:1px solid var(--t-line)}
html .prog{background:var(--t-hover)}
html .prog i{background:linear-gradient(90deg,var(--t-a),var(--t-b))}
html .scard{background:var(--t-card);border:1px solid var(--t-line)}
html .scard a{color:var(--t-link)}
html .tcard{background:var(--t-card);border-color:var(--t-line)}
html .tcard:hover{border-color:var(--t-line2)}
html .tcard.on{border-color:var(--t-a)}

html .gcard.cur{border-color:var(--t-a)}
html #gGrid .gcard:hover{border-color:var(--t-a);box-shadow:var(--t-glow)}
html #gGrid .gcard::after{background:radial-gradient(circle at var(--mx,50%) var(--my,50%),var(--t-spot),transparent 72%)}
`;

const BROWSER = `
html body{background:var(--t-bg);color:var(--tx)}
html #tabs{background:var(--t-strip)}
html .tab{background:var(--t-tab);color:var(--mut)}
html .tab:hover{background:var(--t-hover);color:var(--tx)}
html .tab.on{background:var(--t-panel);color:var(--tx);box-shadow:inset 0 2px 0 var(--t-a)}
html .tab .x:hover{background:var(--t-line)}
html .sp{border:2px solid var(--t-line2);border-top-color:var(--t-a)}
html #plus{color:var(--mut)}
html #plus:hover{background:var(--t-hover);color:var(--tx)}
html #tools{background:var(--t-panel);border-bottom:1px solid var(--t-line)}
html .ib:hover:not(:disabled){background:var(--t-hover)}
html #addr{background:var(--t-input);border:1px solid var(--t-line2);color:var(--tx)}
html #addr:focus{border-color:var(--t-a)}
html #dl{background:var(--t-a);border:2px solid var(--t-a);color:var(--t-on-a)}
html #dl:hover{background:var(--t-a-hover);border-color:var(--t-a-hover)}
html #dlDot{background:currentColor;box-shadow:0 0 0 0 currentColor;animation:pulse2 1.1s infinite}
@keyframes pulse2{70%{box-shadow:0 0 0 7px transparent}100%{box-shadow:0 0 0 0 transparent}}
`;

const NEWTAB = `
html body{background:var(--t-bg);color:var(--mut)}
html h1{color:var(--tx)}
html h1 span{background:linear-gradient(90deg,var(--t-a),var(--t-b));-webkit-background-clip:text;background-clip:text;color:transparent}
`;

const MENU = `
html body{color:var(--tx)}
html #m{background:var(--t-menu);border:1px solid var(--t-line2)}
html .i:hover{background:var(--t-a-soft)}
html .i.off:hover{background:none}
html .s i{background:var(--t-line)}
`;

const DLPANEL = `
html body{color:var(--tx)}
html #p{background:var(--t-menu);border:1px solid var(--t-line2);box-shadow:none}
html #h small,html .sb,html .em{color:var(--mut)}
html .sb.bad{color:var(--bad)}
html .it:hover{background:var(--t-hover)}
html .ic{background:var(--t-thumb);border:1px solid var(--t-line2)}
html .pr{background:var(--t-hover)}
html .pr i{background:linear-gradient(90deg,var(--t-a),var(--t-b))}
html .x{background:var(--t-hover)}
html .x:hover{background:var(--t-line)}
html .ib{background:var(--t-a);border:1px solid var(--t-a);color:var(--t-on-a)}
html .ib:hover{background:var(--t-a-hover);border-color:var(--t-a-hover)}
html #all{background:var(--t-a);border:2px solid var(--t-a);color:var(--t-on-a)}
html #all:hover{background:var(--t-a-hover);border-color:var(--t-a-hover)}
`;

const PICKER = `
html body{background:var(--t-scrim);color:var(--tx)}
html #box{background:var(--t-card);border:1px solid var(--t-line2)}
html #p,html #tools small,html .e{color:var(--mut)}
html #p b{color:var(--tx)}
html #pb{background:var(--t-card);border:1px solid var(--t-line2);color:var(--tx)}
html #pb:hover{background:var(--t-hover)}
html .ddMenu{background:var(--t-menu);border:1px solid var(--t-line2);box-shadow:var(--t-shadow)}
html .ddi{color:var(--tx)}
html .ddi:hover{background:var(--t-hover)}
html .ddi.on{background:var(--t-a-soft);color:var(--t-a-text)}
html #tag{background:var(--t-hover);border:1px solid var(--t-line);color:var(--mut)}
html #q{background:var(--t-input);border:1px solid var(--t-line2);color:var(--tx)}
html #q:focus{border-color:var(--t-a)}
html .i{background:var(--t-hover)}
html .i:hover{background:var(--t-line)}
html .i.on{background:var(--t-a-soft)}
html .c{border:2px solid var(--t-line2)}
html .i.on .c{background:var(--t-a);border-color:var(--t-a);color:var(--t-on-a)}
html button{background:var(--t-a);color:var(--t-on-a)}
html button.g{background:var(--t-hover);color:var(--tx)}
`;

export const LAYERS: Record<Page, string> = { main: MAIN, browser: BROWSER, newtab: NEWTAB, menu: MENU, dlpanel: DLPANEL, picker: PICKER };
