'use client';

import { LazyLoadImage } from 'react-lazy-load-image-component';

import { cn } from '@/shared/lib/utils';

import 'react-lazy-load-image-component/src/effects/blur.css';

export function LazyImage({
  src,
  alt,
  className,
  width,
  height,
  placeholderSrc,
  title,
  fill,
  priority,
  sizes,
}: {
  src: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
  placeholderSrc?: string;
  title?: string;
  fill?: boolean;
  priority?: boolean;
  sizes?: string;
}) {
  return (
    <LazyLoadImage
      src={src}
      alt={alt}
      title={title}
      sizes={sizes}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      effect={priority ? undefined : 'blur'}
      visibleByDefault={priority}
      placeholderSrc={placeholderSrc}
      wrapperClassName={fill ? 'absolute inset-0 h-full w-full' : undefined}
      className={cn(fill && 'h-full w-full', className)}
    />
  );
}
