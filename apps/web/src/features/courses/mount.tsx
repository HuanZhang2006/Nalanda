import { createRoot } from "react-dom/client";
import { CoursesApp } from "./CoursesApp";

export function mountCourses(element: HTMLElement, options: Parameters<typeof CoursesApp>[0] = {}) {
  const root = createRoot(element); root.render(<CoursesApp {...options} />); return () => root.unmount();
}
