import { SCREEN } from "../site";

interface PhoneProps {
  src: string;
  alt: string;
  className?: string;
  eager?: boolean;
}

export function Phone({ src, alt, className, eager = false }: PhoneProps) {
  return (
    <figure className={className ? `phone ${className}` : "phone"}>
      <img
        src={src}
        alt={alt}
        width={SCREEN.width}
        height={SCREEN.height}
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : undefined}
        decoding="async"
      />
    </figure>
  );
}
