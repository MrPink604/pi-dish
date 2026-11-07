/** Id lookup for markup the bundle guarantees; a missing id throws instead of cascading nulls. */
export function requiredElement(document: Document, label: string) {
  return <T extends HTMLElement = HTMLElement>(id: string): T => {
    const value = document.getElementById(id);
    if (!value) throw new Error(`Missing ${label} element: ${id}`);
    return value as T;
  };
}
