/**
 * Utility functions for file upload and validation
 */

// Allowed image MIME types
const ALLOWED_IMAGE_TYPES = [
	"image/jpeg",
	"image/jpg",
	"image/png",
	"image/gif",
	"image/webp",
	"image/svg+xml",
];

// Max file size: 10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Validate if a file is a valid image
 */
export function validateImage(file: File): { valid: boolean; error?: string } {
	// Check if file exists
	if (!file) {
		return { valid: false, error: "No file provided" };
	}

	// Check file type
	if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
		return {
			valid: false,
			error: `Invalid file type: ${file.type}. Allowed types: ${ALLOWED_IMAGE_TYPES.join(", ")}`,
		};
	}

	// Check file size
	if (file.size > MAX_FILE_SIZE) {
		return {
			valid: false,
			error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
		};
	}

	return { valid: true };
}

/**
 * Generate a unique filename for uploaded files
 */
export function generateUniqueFilename(originalFilename: string): string {
	const extension = originalFilename.split(".").pop() || "jpg";
	const namePrefix = originalFilename.substring(0, 10).replace(/[^a-zA-Z0-9]/g, "_");
	const uniqueId = crypto.randomUUID().substring(0, 40);
	return `${namePrefix}_${uniqueId}.${extension}`;
}

/**
 * Upload a file to Cloudflare R2 storage
 * @param bucket R2 bucket binding
 * @param key Object key (path) in the bucket
 * @param file File to upload
 * @returns The key of the uploaded file
 */
export async function uploadToR2(bucket: R2Bucket, key: string, file: File): Promise<string> {
	const arrayBuffer = await file.arrayBuffer();

	await bucket.put(key, arrayBuffer, {
		httpMetadata: {
			contentType: file.type,
		},
	});

	return key;
}

/**
 * Delete a file from Cloudflare R2 storage
 * @param bucket R2 bucket binding
 * @param key Object key (path) in the bucket
 */
export async function deleteFromR2(bucket: R2Bucket, key: string): Promise<void> {
	await bucket.delete(key);
}

/**
 * Get a public URL for an R2 object
 * @param publicUrl Base public URL for the R2 bucket
 * @param key Object key (path) in the bucket
 * @returns Full public URL to access the file
 */
export function getPublicUrl(publicUrl: string, key: string): string {
	return `${publicUrl}/${key}`;
}
