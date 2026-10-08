import { useEffect } from "react";

/** Adds `is-in` to every `.reveal` as it scrolls into view (CSS hides them only once JS is running). */
export function useReveal() {
  useEffect(() => {
    const items = document.querySelectorAll(".reveal:not(.is-in)");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    items.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}
