export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function h(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

export function button(label: string, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = h("button", { class: cls, type: "button" }, label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}
