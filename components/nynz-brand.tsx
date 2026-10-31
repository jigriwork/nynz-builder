import Image from "next/image";

export function NynzBrand({ className = "h-6" }: { className?: string }) {
  return <Image src="/brand/nynz-wordmark.png" alt="NYNZ" width={1086} height={362} priority className={`${className} w-auto object-contain`} />;
}

export function NynzIcon({ className = "h-7 w-7" }: { className?: string }) {
  return <Image src="/brand/nynz-icon.png" alt="" width={256} height={256} priority className={`${className} rounded-md object-cover`} />;
}
