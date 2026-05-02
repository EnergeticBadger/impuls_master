


export function Image({ src, w, h, alt }: { src: string, w: number, h: number, alt: string }) {
    /**
 * Transforms a Scryfall URI into an optimized proxy URI.
 * @param url - The original Scryfall image_uri
 * @param width - The desired width in pixels
 */
    const getOptimizedImage = (url: string, width: number = 480): string => {
        const params = new URLSearchParams({
            url: url,          // The source image
            w: width.toString(), // Resize to this width
            output: 'webp',    // Force WebP format
            q: '95',           // Compression quality (1-100)
            il: '',            // Interlace/Progressive loading
        });

        return `https://wsrv.nl/?${params.toString()}`;
    };
    
    return (<img src={getOptimizedImage(src, w)} alt={alt} width={w} height={h} />)
}