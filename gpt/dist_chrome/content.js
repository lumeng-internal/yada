var pe=Object.defineProperty;var me=(h,l,f)=>l in h?pe(h,l,{enumerable:!0,configurable:!0,writable:!0,value:f}):h[l]=f;var d=(h,l,f)=>me(h,typeof l!="symbol"?l+"":l,f);(function(){"use strict";function h(t=window.location.href){try{return new URL(t).hostname==="chatgpt.com"}catch{return!1}}function l(t=window.location.href){var e,n,r;try{const o=new URL(t);return((e=o.pathname.match(/^\/c\/([a-z0-9-]+)/i))==null?void 0:e[1])??((n=o.pathname.match(/^\/g\/[a-z0-9-]+\/c\/([a-z0-9-]+)/i))==null?void 0:n[1])??null}catch{return((r=t.match(/\/c\/([a-z0-9-]+)/i))==null?void 0:r[1])??null}}function f(t=window.location.href){return h(t)&&l(t)!==null}const I=[[/\.pdf$/i,"PDF 文件"],[/\.(?:md|markdown)$/i,"Markdown 文件"],[/\.csv$/i,"CSV 文件"],[/\.txt$/i,"文本文件"],[/\.json$/i,"JSON 文件"],[/\.(?:xlsx|xls)$/i,"Excel 文件"],[/\.(?:docx|doc)$/i,"Word 文件"],[/\.(?:zip|rar|7z)$/i,"压缩文件"]],L=/\.(?:png|jpe?g|webp|gif|bmp|heic|heif|avif)$/i;function T(t){return t.map(z).filter(Boolean).join(" ")}function P(t,e){const n=N(t),r=T(e);return n&&r?`${r}
${n}`:n||r||""}function B(){return"[无文字消息]"}function M(t){const e=[],n=p(t.content),r=p(t.metadata);if(Array.isArray(n==null?void 0:n.parts))for(const s of n.parts)w(s,e);const o=e.some(s=>s.kind==="image");for(const s of["attachments","files","uploaded_files"]){const i=(r==null?void 0:r[s])??t[s];if(Array.isArray(i))for(const b of i){const $=[];w(b,$),e.push(...$.filter(fe=>!(o&&fe.kind==="image")))}}const a=p(r==null?void 0:r.aggregate_result);if(Array.isArray(a==null?void 0:a.messages))for(const s of a.messages){const i=p(s);if(i&&c(i,"message_type")==="image"){const b=c(i,"image_url")??c(i,"url")??void 0;e.push({kind:"image",label:"图片",key:y("image",b??"aggregate")})}}return O(e)}function j(t,e){if(e!=null&&e.includes("pdf"))return"PDF 文件";if(e!=null&&e.includes("markdown"))return"Markdown 文件";if(e!=null&&e.includes("json"))return"JSON 文件";if(e!=null&&e.includes("csv"))return"CSV 文件";if(e!=null&&e.includes("text"))return"文本文件";if(e!=null&&e.includes("spreadsheet")||e!=null&&e.includes("excel"))return"Excel 文件";if(e!=null&&e.includes("word"))return"Word 文件";if(t){const n=I.find(([r])=>r.test(t));if(n)return n[1]}return"文件"}function z(t){return t.kind==="image"?"[图片]":t.kind==="pasted"?"[粘贴内容]":t.kind==="file"?t.filename?`[${t.label}] ${t.filename}`:`[${t.label}]`:""}function w(t,e){const n=p(t);if(!n)return;const r=(c(n,"content_type")??c(n,"type")??"").toLowerCase(),o=c(n,"file_name")??c(n,"filename")??c(n,"name")??c(n,"title")??void 0,a=c(n,"mime_type")??c(n,"mimetype")??c(n,"mime")??void 0,s=c(n,"asset_pointer")??c(n,"image_asset_pointer")??c(n,"url")??c(n,"href")??void 0,i=y("api",s??o??a??r);if(R(r,o,a,s)){e.push({kind:"image",label:"图片",key:i});return}if(r.includes("paste")||r.includes("pasted")||n.pasted===!0){e.push({kind:"pasted",label:"粘贴内容",key:i??"pasted"});return}if(o||r.includes("file")||a){e.push({kind:"file",label:j(o,a),filename:o,mimeType:a,key:i});return}}function O(t){const e=new Set,n=[];let r=0;for(const o of t){const a=D(o,r);o.kind==="image"&&!o.key&&(r+=1),!e.has(a)&&(e.add(a),n.push({kind:o.kind,label:o.label,filename:o.filename,mimeType:o.mimeType}))}return n}function N(t){return t.replace(/\u00a0/g," ").replace(/[ \t]+\n/g,`
`).replace(/\n{3,}/g,`

`).trim()}function p(t){return t&&typeof t=="object"?t:null}function c(t,e){const n=t[e];return typeof n=="string"&&n.trim()?n.trim():null}function R(t,e,n,r){return t.includes("image")||(n==null?void 0:n.toLowerCase().startsWith("image/"))===!0||F(e)||(r==null?void 0:r.startsWith("sediment://"))===!0||(r==null?void 0:r.startsWith("data:image/"))===!0}function F(t){return!!(t&&L.test(t))}function D(t,e){return t.key?`${t.kind}:${t.key}`:t.kind==="image"?`image:${t.filename??`anonymous-${e}`}`:t.kind==="pasted"?"pasted":`file:${t.filename??""}:${t.mimeType??""}:${t.label}`}function y(t,e){const n=e.replace(/\s+/g," ").trim().toLowerCase();return n?`${t}:${n}`:void 0}let v=null;async function G(t=l()){return t?U(t):null}async function U(t){const e={Accept:"application/json"},n=await q();n&&(e.Authorization=`Bearer ${n}`,e["X-Authorization"]=`Bearer ${n}`);const r=V();r&&(e["Chatgpt-Account-Id"]=r);const o=await fetch(`/backend-api/conversation/${encodeURIComponent(t)}`,{credentials:"include",headers:e});if(!o.ok)throw new Error(`ChatGPT conversation API failed: ${o.status}`);const a=await o.json();return{...a,id:a.id??a.conversation_id??t}}async function q(){return v??(v=Y()),v}async function Y(){try{const t=await fetch("/api/auth/session",{credentials:"include",headers:{Accept:"application/json"}});if(!t.ok)return null;const e=await t.json();return typeof e.accessToken=="string"?e.accessToken:null}catch{return null}}function V(){try{const t=window.localStorage.getItem("_account");if(!t)return null;if(/^account-[a-z0-9_-]+$/i.test(t))return t;const e=JSON.parse(t);return k(e)}catch{return null}}function k(t){if(!t||typeof t!="object")return null;const e=t;for(const n of["accountId","account_id","currentAccountId","current_account_id","id"]){const r=e[n];if(typeof r=="string"&&/^account-[a-z0-9_-]+$/i.test(r))return r}for(const n of Object.values(e)){const r=k(n);if(r)return r}return null}async function W(t={}){const e=t.conversationId??l();if(!e)throw new Error("No active ChatGPT conversation");const n=await G(e);if(!n)throw new Error("ChatGPT conversation was not returned");const r=H(n);return{conversationId:n.id??e,source:"api-full",turns:r,capturedAt:Date.now(),apiTurnsLength:r.length,domTurnsLength:0,usingCachedApiTurns:!1,lastStableTurnsLength:r.length}}function H(t){const e=J(t),n=[];let r=null;for(const o of e){const a=o.message;if(!a||X(a))continue;const s=x(a);if(s!=="user"&&s!=="assistant")continue;const i=K(a);if(i.markdown){if(s==="user"){r&&n.push(g(n.length,r,null)),r=i;continue}r&&(n.push(g(n.length,r,i)),r=null)}}return r&&n.push(g(n.length,r,null)),n}function J(t){var s;const e=t.mapping??{},n=t.current_node??((s=Object.values(e).find(i=>!i.children||i.children.length===0))==null?void 0:s.id),r=[],o=new Set;let a=n;for(;a&&!o.has(a);){o.add(a);const i=e[a];if(!i||i.parent===void 0&&!i.message)break;r.unshift(i),a=i.parent}return r}function g(t,e,n){return{id:e.messageId??(n==null?void 0:n.messageId)??`api-turn-${t+1}`,index:t,globalIndex:t,displayNumber:t+1,renderedLocalIndex:null,userMessageId:e.messageId,assistantMessageId:n==null?void 0:n.messageId,userMarkdown:e.markdown,assistantMarkdown:(n==null?void 0:n.markdown)??"",userPreview:e.preview,assistantPreview:(n==null?void 0:n.preview)??"",attachments:[...e.attachments,...(n==null?void 0:n.attachments)??[]]}}function X(t){if(!t.content)return!0;const e=x(t);if(e==="system"||e==="tool")return!0;const n=t.recipient;if(n&&n!=="all")return!0;const r=t.channel;if(r&&r!=="final")return!0;const o=t.metadata??{};if(o.is_visually_hidden_from_conversation===!0||o.is_hidden===!0||o.hidden===!0)return!0;const a=u(t.content,"content_type");return a==="thoughts"||a==="reasoning_recap"||a==="model_editable_context"||a==="user_editable_context"}function K(t){const e=M(t),n=P(Q(t),e)||B();return{messageId:t.id,markdown:n,preview:te(n),attachments:e}}function Q(t){const e=t.content;if(!e)return"";const n=u(e,"content_type");if(n==="text")return m(ee(e.parts));if(n==="multimodal_text")return m(Z(e.parts));if(n==="code"){const r=u(e,"language")??"",o=u(e,"text")??"";return o?`\`\`\`${r}
${o}
\`\`\``:""}if(n==="execution_output"){const r=u(e,"text")??"";return r?`Result:
\`\`\`
${r}
\`\`\``:""}if(n==="tether_quote"){const r=u(e,"title")??"",o=u(e,"text")??"";return m(`> ${r||o}`)}if(n==="tether_browsing_display"){const r=u(e,"result")??u(e,"summary")??"";return m(r)}return""}function Z(t){return Array.isArray(t)?t.map(e=>{if(typeof e=="string")return e;if(!e||typeof e!="object")return"";const n=e,r=u(n,"content_type")??u(n,"type")??"";return r.includes("image")||r.includes("file")?"":u(n,"text")??u(n,"content")??u(n,"markdown")??""}).filter(Boolean).join(`

`):""}function ee(t){return Array.isArray(t)?t.map(e=>typeof e=="string"?e:"").filter(Boolean).join(`

`):""}function x(t){var e;return(e=t.author)==null?void 0:e.role}function u(t,e){const n=t[e];return typeof n=="string"&&n.trim()?n.trim():null}function m(t){return t.replace(/\u00a0/g," ").replace(/[ \t]+\n/g,`
`).replace(/\n{3,}/g,`

`).trim()}function te(t){const e=t.replace(/```[\s\S]*?```/g,"[代码块]").replace(/[#*_>`~-]/g,"").replace(/[ \t]+/g," ").replace(/\n{3,}/g,`

`).trim();return e.length>180?`${e.slice(0,179)}…`:e}async function ne(t){try{await navigator.clipboard.writeText(t);return}catch{re(t)}}function re(t){const e=document.createElement("textarea");e.value=t,e.setAttribute("readonly","true"),e.style.position="fixed",e.style.top="-1000px",e.style.left="-1000px",document.documentElement.append(e),e.select();const n=document.execCommand("copy");if(e.remove(),!n)throw new Error("Clipboard fallback failed")}function oe(t){const e=t.map(ae).filter(Boolean).join(`

`).replace(/\n{4,}/g,`


`).trim();return e?`${e}
`:""}function ae(t){return[C("User",t.userMarkdown),C("ChatGPT",t.assistantMarkdown)].filter(Boolean).join(`

`)}function C(t,e){const n=e.trim();return n?`# ${t}

${n}`:""}const ie="#10A37F",se="rgba(16, 163, 127, 0.14)",A="chatgpt-yada-toolbar-host";function _(){const t=document.documentElement,e=S(t,"data-theme")??S(document.body,"data-theme");return e!=null&&e.toLowerCase().includes("dark")?"dark":e!=null&&e.toLowerCase().includes("light")?"light":t.classList.contains("dark")?"dark":t.classList.contains("light")?"light":getComputedStyle(t).colorScheme.includes("dark")||window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}function S(t,e){return t instanceof Element?t.getAttribute(e):null}function ce(t){const e=()=>t(_()),n=new MutationObserver(e);n.observe(document.documentElement,{attributes:!0,attributeFilter:["class","data-theme"]}),n.observe(document.body,{attributes:!0,attributeFilter:["class","data-theme"]});const r=window.matchMedia("(prefers-color-scheme: dark)");return r.addEventListener("change",e),e(),()=>{n.disconnect(),r.removeEventListener("change",e)}}class ue{constructor(){d(this,"host",null);d(this,"shadow",null);d(this,"disposeTheme",null);d(this,"copyResetTimer",0);d(this,"copyBusy",!1);d(this,"placementObserver",null);d(this,"placementTimer",0);d(this,"handleViewportChange",()=>{this.ensurePlacement()})}mount(){var e,n,r;(e=this.host)!=null&&e.isConnected||((n=document.getElementById(A))==null||n.remove(),this.host=document.createElement("div"),this.host.id=A,this.host.dataset.yadaRoot="true",this.host.dataset.placement="fixed",this.host.dataset.visible="false",this.host.setAttribute("data-yada-theme",_()),this.shadow=this.host.attachShadow({mode:"open"}),document.documentElement.append(this.host),this.render(),(r=this.query("[data-copy-all]"))==null||r.addEventListener("click",()=>{this.copyAll()}),this.disposeTheme=ce(o=>{var a;(a=this.host)==null||a.setAttribute("data-yada-theme",o)}),this.placementObserver=new MutationObserver(()=>this.schedulePlacement()),this.placementObserver.observe(document.body,{childList:!0,subtree:!0}),window.addEventListener("resize",this.handleViewportChange,{passive:!0}),this.ensurePlacement())}setVisible(e){var n;(n=this.host)==null||n.setAttribute("data-visible",e?"true":"false")}ensurePlacement(){if(!this.host)return;const e=de();if(e){this.host.parentElement!==e&&e.insertBefore(this.host,e.firstElementChild),this.host.dataset.placement="inline";return}this.host.parentElement!==document.documentElement&&document.documentElement.append(this.host),this.host.dataset.placement="fixed"}dispose(){var e,n,r;window.clearTimeout(this.copyResetTimer),window.clearTimeout(this.placementTimer),(e=this.placementObserver)==null||e.disconnect(),(n=this.disposeTheme)==null||n.call(this),window.removeEventListener("resize",this.handleViewportChange),(r=this.host)==null||r.remove(),this.host=null,this.shadow=null}render(){this.shadow&&(this.shadow.innerHTML=`
      <style>
        :host {
          --yada-primary: ${ie};
          --yada-primary-soft: ${se};
          --yada-text: #202123;
          --yada-muted: rgba(32, 33, 35, 0.64);
          --yada-button-bg: rgba(255, 255, 255, 0.68);
          --yada-button-border: rgba(32, 33, 35, 0.16);
          display: inline-flex;
          align-items: center;
          position: relative;
          z-index: 2147483500;
          color-scheme: light;
          font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: auto;
        }

        :host([data-visible="false"]) {
          display: none;
        }

        :host([data-placement="fixed"]) {
          position: fixed;
          top: 16px;
          right: 88px;
        }

        :host([data-placement="inline"]) {
          margin-right: 2px;
        }

        :host([data-yada-theme="dark"]) {
          --yada-text: #ececec;
          --yada-muted: rgba(236, 236, 236, 0.66);
          --yada-button-bg: rgba(32, 33, 35, 0.68);
          --yada-button-border: rgba(236, 236, 236, 0.16);
          color-scheme: dark;
        }

        button {
          appearance: none;
          height: 29px;
          padding: 0 10px;
          border: 1px solid var(--yada-button-border);
          border-radius: 999px;
          background: var(--yada-button-bg);
          color: var(--yada-text);
          cursor: pointer;
          font: 600 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0;
          white-space: nowrap;
        }

        button:hover,
        button:focus-visible {
          border-color: rgba(16, 163, 127, 0.45);
          color: var(--yada-primary);
          outline: none;
        }

        button[data-state="pending"] {
          background: rgba(32, 33, 35, 0.05);
          color: var(--yada-muted);
        }

        button[data-state="success"] {
          border-color: rgba(16, 163, 127, 0.32);
          background: var(--yada-primary-soft);
          color: var(--yada-primary);
        }

        button[data-state="error"],
        button[data-state="empty"] {
          border-color: rgba(209, 67, 67, 0.28);
          background: rgba(209, 67, 67, 0.1);
          color: #d14343;
        }

        button:disabled {
          cursor: default;
          opacity: 0.66;
        }
      </style>
      <button type="button" data-copy-all data-state="idle">复制全部</button>
    `)}async copyAll(){if(!this.copyBusy){this.copyBusy=!0,this.setCopyState("pending","复制中...",0);try{const e=await W(),n=oe(e.turns);if(!n){this.setCopyState("empty","没有可复制内容");return}await ne(n),this.setCopyState("success",`已复制 ${e.turns.length} 轮`)}catch(e){console.error("ChatGPT Yada: copy all failed",e),this.setCopyState("error","复制失败")}finally{this.copyBusy=!1;const e=this.query("[data-copy-all]");(e==null?void 0:e.dataset.state)!=="pending"&&(e==null||e.removeAttribute("disabled"))}}}setCopyState(e,n="复制全部",r=1800){window.clearTimeout(this.copyResetTimer);const o=this.query("[data-copy-all]");o&&(o.dataset.state=e,o.textContent=n,o.disabled=e==="pending",r>0&&e!=="idle"&&(this.copyResetTimer=window.setTimeout(()=>{o.isConnected&&(o.dataset.state="idle",o.textContent="复制全部",o.disabled=!1)},r)))}schedulePlacement(){window.clearTimeout(this.placementTimer),this.placementTimer=window.setTimeout(()=>this.ensurePlacement(),180)}query(e){var n;return((n=this.shadow)==null?void 0:n.querySelector(e))??null}}function de(){const t=document.querySelector("#page-header #conversation-header-actions");if(t)return t;const e=["#conversation-header-actions",'[data-testid="conversation-header-actions"]','header [aria-label*="Share" i]','header [data-testid*="share" i]',"main ~ div header button"];for(const o of e){const a=document.querySelector(o),s=a==null?void 0:a.parentElement;if(s&&E(s))return s}const n=document.querySelector("header"),r=n==null?void 0:n.querySelector('button, [role="button"]');return r!=null&&r.parentElement&&E(r.parentElement)?r.parentElement:null}function E(t){const e=t.getBoundingClientRect();return e.width>0&&e.height>0&&e.top<120&&e.right>window.innerWidth*.45}function le(t){let e=window.location.href;const n=()=>{const o=window.location.href;if(o===e)return;const a=e;e=o,t(o,a)},r=window.setInterval(n,500);return window.addEventListener("popstate",n),window.addEventListener("hashchange",n),()=>{window.clearInterval(r),window.removeEventListener("popstate",n),window.removeEventListener("hashchange",n)}}console.info("ChatGPT Yada Copy loaded");class he{constructor(){d(this,"toolbar",new ue);d(this,"routeDispose",null);d(this,"mounted",!1)}mount(){this.mounted||(this.mounted=!0,this.toolbar.mount(),this.syncPageState(),this.routeDispose=le(()=>this.syncPageState()))}dispose(){var e;(e=this.routeDispose)==null||e.call(this),this.routeDispose=null,this.toolbar.dispose(),this.mounted=!1}syncPageState(){this.toolbar.ensurePlacement(),this.toolbar.setVisible(f())}}h()&&new he().mount()})();
