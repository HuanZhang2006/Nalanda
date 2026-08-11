import { createRoot } from "react-dom/client";
import { NotesView } from "./NotesView";

export function mountAiNotes(element: HTMLElement, props: Parameters<typeof NotesView>[0]) {
  const root = createRoot(element);
  root.render(<NotesView {...props} />);
  return () => root.unmount();
}

