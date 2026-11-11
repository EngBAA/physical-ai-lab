// Native vector animation: crisp at launcher size and in the conversation.
// Props share the character's coordinate system so hands and objects move together.
let serial = 0;
export const idleActions = ['wave', 'reading', 'bubbles', 'balloons', 'inspecting'];

export function avatar() {
  const id = `masar-${++serial}`;
  const wheel = x => `<g class="wheel" style="--wheel-x:${x}px"><circle cx="${x}" cy="217" r="32" fill="#f6f2e9" stroke="#45534b" stroke-width="5"/><circle cx="${x}" cy="217" r="25" fill="none" stroke="#d0d5ca"/><g class="spokes" style="transform-origin:${x}px 217px" stroke="#9ba79c" stroke-width="1.5"><path d="M${x-29} 217h58m-29-29v58m-21-50 42 42m-42 0 42-42"/></g><circle cx="${x}" cy="217" r="4" fill="#45534b"/></g>`;
  return `<div class="avatar" data-pose="wave" data-action="wave">
    <svg viewBox="0 0 300 330" aria-hidden="true" class="character">
      <defs>
        <radialGradient id="${id}" cx="32%" cy="20%" r="88%"><stop stop-color="#fffefa"/><stop offset=".65" stop-color="#f4f3ed"/><stop offset="1" stop-color="#c7cec6"/></radialGradient>
        <linearGradient id="${id}-arm" x2="1" y2="1"><stop stop-color="#fffefa"/><stop offset="1" stop-color="#d2d7cf"/></linearGradient>
        <linearGradient id="${id}-bubble" x2="1" y2="1"><stop stop-color="#adc9c4" stop-opacity=".25"/><stop offset=".5" stop-color="#fff" stop-opacity=".1"/><stop offset="1" stop-color="#d7ada5" stop-opacity=".45"/></linearGradient>
      </defs>
      <g transform="translate(40 60)">
        <ellipse class="shadow" cx="110" cy="244" rx="57" ry="6" fill="#485245" opacity=".12"/>
        <g class="pet-scene">
          <g class="prop balloon-prop">
            <g class="balloon-cluster">
              <g fill="none" stroke="#9a9c8b" stroke-width="1.1"><path d="M135 12Q142 66 224 114M181-4Q177 70 224 114M219 26Q220 72 224 114M94 29Q111 81 224 114"/></g>
              <g class="balloon balloon-one"><ellipse cx="135" cy="-13" rx="22" ry="29" fill="#c4826c"/><path d="m135 15-4 5h8z" fill="#b47360"/><path d="M123-30q-8 7-7 17" fill="none" stroke="#f3d2bd" stroke-width="3" stroke-linecap="round"/></g>
              <g class="balloon balloon-two"><ellipse cx="181" cy="-31" rx="23" ry="30" fill="#a6b6a0"/><path d="m181-2-4 6h8z" fill="#8f9f88"/><path d="M168-48q-7 6-7 17" fill="none" stroke="#dce3ce" stroke-width="3" stroke-linecap="round"/></g>
              <g class="balloon balloon-three"><ellipse cx="219" cy="1" rx="21" ry="27" fill="#d8b96e"/><path d="m219 27-4 5h8z" fill="#baa05b"/><path d="M207-14q-6 5-6 14" fill="none" stroke="#f1dfad" stroke-width="3" stroke-linecap="round"/></g>
              <g class="balloon balloon-four"><ellipse cx="94" cy="7" rx="18" ry="24" fill="#9fbac0"/><path d="m94 30-3 5h6z" fill="#7b9ca5"/><path d="M84-7q-5 5-5 12" fill="none" stroke="#d6e4e2" stroke-width="3" stroke-linecap="round"/></g>
            </g>
          </g>
          <g class="body">
            <g class="feet"><ellipse cx="86" cy="210" rx="22" ry="28" fill="url(#${id})"/><ellipse cx="135" cy="210" rx="22" ry="28" fill="url(#${id})"/></g>
            <g class="arm arm-left"><path d="M69 97C44 95 34 121 29 155c-3 21 13 28 22 14l30-48" fill="url(#${id}-arm)" stroke="#fff" stroke-opacity=".6"/></g>
            <g class="arm arm-right"><path d="M153 97c25-2 35 24 40 58 3 21-13 28-22 14l-30-48" fill="url(#${id}-arm)" stroke="#fff" stroke-opacity=".6"/></g>
            <path d="M110 83c-41 0-64 38-64 81 0 42 25 56 64 56s64-14 64-56c0-43-23-81-64-81" fill="url(#${id})" stroke="#fff" stroke-opacity=".7"/>
            <path d="M62 160c2 27 18 40 48 42" fill="none" stroke="#fff" stroke-width="3" opacity=".5"/>
            <circle cx="136" cy="122" r="8" fill="#e6e9dd" stroke="#b5bca8"/><path d="m132 122 3 3 5-6" stroke="#8a997e" fill="none" stroke-width="1.5"/>
            <g class="head"><ellipse cx="110" cy="67" rx="49" ry="32" fill="url(#${id})" stroke="#fff" stroke-opacity=".8"/>
              <path d="M89 66h42" stroke="#303d37" stroke-width="2.5"/>
              <g class="eyes" fill="#27362e"><circle cx="88" cy="66" r="5"/><circle cx="132" cy="66" r="5"/></g>
              <g class="happy-eyes" fill="none" stroke="#27362e" stroke-width="3" stroke-linecap="round"><path d="M82 68q6-9 12 0M126 68q6-9 12 0"/></g>
              <g class="blush" fill="#ce9387"><ellipse cx="78" cy="77" rx="7" ry="3"/><ellipse cx="142" cy="77" rx="7" ry="3"/></g>
            </g>
          </g>
          <g class="prop book-prop">
            <path d="M57 134q29-8 53 5 24-13 53-5v52q-30-7-53 5-23-12-53-5z" fill="#617765" stroke="#4f6354" stroke-width="3" stroke-linejoin="round"/>
            <path d="M61 130q26-6 49 8 23-14 49-8v50q-27-5-49 7-22-12-49-7z" fill="#f7f0dc"/>
            <path d="M110 138v49" stroke="#d1c7ab" stroke-width="1.5"/>
            <g stroke="#c6bda6" stroke-width="1.5" fill="none"><path d="m69 143 30 5m-30 5 30 5m-30 5 23 4m26-19 30-5m-30 15 30-5m-30 15 23-4"/></g>
            <path class="book-page" d="M110 138q24-13 48-8v50q-25-5-48 7z" fill="#eee5cf" stroke="#d1c7ab" stroke-width=".8"/>
            <ellipse cx="59" cy="160" rx="10" ry="13" fill="url(#${id})" transform="rotate(-15 59 160)"/><ellipse cx="162" cy="160" rx="10" ry="13" fill="url(#${id})" transform="rotate(15 162 160)"/>
          </g>
          <g class="prop bike-prop">
            <path d="M73 124q24 25 76 15M145 124q22-3 19 14" fill="none" stroke="url(#${id}-arm)" stroke-width="16" stroke-linecap="round"/>
            <ellipse cx="164" cy="138" rx="9" ry="10" fill="url(#${id})"/>
            ${wheel(48)}${wheel(176)}
            <g stroke="#b87962" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="m48 217 37-58 25 58H48m62 0 45-58H85m70 0 21 58m-21-58-7-23h16"/></g>
            <path d="m85 159-5-14m-13 0h27" fill="none" stroke="#45534b" stroke-width="5" stroke-linecap="round"/>
            <g class="pedals"><path d="m96 205 28 24" stroke="#45534b" stroke-width="3"/><path d="M88 205h16m12 24h16" stroke="#45534b" stroke-width="4" stroke-linecap="round"/></g>
            <g class="pedal-foot"><ellipse cx="112" cy="201" rx="17" ry="10" fill="url(#${id})" stroke="#d1d6cc"/></g>
            <circle cx="110" cy="217" r="5" fill="#45534b"/>
            <path class="speed-line" d="M8 170h22M1 183h16M7 196h19" fill="none" stroke="#a9b6a5" stroke-width="2" stroke-linecap="round"/>
          </g>
          <g class="prop lens-prop"><path d="m158 103 23 29" stroke="#b77961" stroke-width="11" stroke-linecap="round"/><ellipse cx="177" cy="129" rx="10" ry="12" fill="url(#${id})"/><circle cx="143" cy="83" r="26" fill="#c7dfda" fill-opacity=".35" stroke="#667d72" stroke-width="5"/><path d="M126 79a18 18 0 0 1 18-14" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="3" stroke-linecap="round"/><circle cx="141" cy="80" r="7" fill="#27362e"/></g>
          <g class="prop bubble-prop">
            <path d="m165 134 12-35" stroke="#b78969" stroke-width="4" stroke-linecap="round"/><ellipse cx="181" cy="89" rx="9" ry="13" transform="rotate(20 181 89)" fill="none" stroke="#b78969" stroke-width="3"/>
            <ellipse cx="165" cy="136" rx="10" ry="12" fill="url(#${id})"/>
            ${[[187,75,13,0],[197,66,19,1.4],[180,64,8,2.8],[195,75,15,4.1]].map(([x,y,r,delay])=>`<g class="soap-bubble" style="--delay:${delay}s"><circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}-bubble)" stroke="#9fbcb7" stroke-width="1.3"/><path d="M${x-r*.55} ${y-r*.3}q0-${r*.4} ${r*.5}-${r*.4}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>`).join('')}
          </g>
        </g>
      </g>
    </svg>
    <span class="heart h1">♥</span><span class="heart h2">♥</span><span class="heart h3">♥</span><span class="listen-ring"></span>
  </div>`;
}
