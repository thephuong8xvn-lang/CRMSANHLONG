import { Package } from 'lucide-react'

interface ProductImageProps {
  src: string | null | undefined
  alt: string
  className?: string
  fallbackClassName?: string
  /** 'cover' for grid thumbnails, 'contain' for detail pages */
  fit?: 'cover' | 'contain'
}

export function ProductImage({ src, alt, className = 'w-full h-full', fallbackClassName, fit = 'cover' }: ProductImageProps) {
  if (!src) {
    return (
      <div className={fallbackClassName ?? `${className} flex items-center justify-center bg-gray-50 text-gray-300`}>
        <Package size={20} />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`${className} object-${fit}`}
      onError={e => {
        const target = e.currentTarget
        target.style.display = 'none'
        const fallback = target.nextElementSibling as HTMLElement | null
        if (fallback) fallback.style.display = 'flex'
      }}
    />
  )
}
