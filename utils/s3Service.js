/**
 * AWS S3 Document Vault — s3Service.js
 *
 * Handles uploading signed agreement PDFs to S3 and generating pre-signed
 * download URLs so tenants / landlords can securely access their documents.
 *
 * Required env vars:
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   AWS_REGION            (e.g. "ap-south-1")
 *   AWS_S3_BUCKET         (e.g. "rentifypro-documents")
 *
 * The bucket should have:
 *   - Versioning enabled
 *   - Server-side encryption (SSE-S3 or SSE-KMS)
 *   - Block all public access enabled (documents accessed via pre-signed URLs only)
 */

const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Lazy-initialise client so the server starts even without S3 env vars configured.
let _s3Client = null;

function _getClient() {
  if (_s3Client) return _s3Client;

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.');
  }

  _s3Client = new S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  return _s3Client;
}

const BUCKET = process.env.AWS_S3_BUCKET || 'rentifypro-documents';

/**
 * Upload a PDF buffer to S3.
 *
 * @param {Buffer}  pdfBuffer  - The raw PDF bytes.
 * @param {string}  agreementId - MongoDB ObjectId string — used to build the S3 key.
 * @returns {Promise<string>}   - The permanent S3 object key (not a pre-signed URL).
 */
async function uploadAgreementPDF(pdfBuffer, agreementId) {
  const client = _getClient();

  // Key pattern: agreements/<year>/<agreementId>/signed-agreement.pdf
  const year = new Date().getFullYear();
  const key = `agreements/${year}/${agreementId}/signed-agreement.pdf`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    // Tag for lifecycle policies
    Tagging: 'Type=SignedAgreement',
    // Server-side encryption
    ServerSideEncryption: 'AES256',
    Metadata: {
      agreementId,
      uploadedAt: new Date().toISOString(),
    },
  });

  await client.send(command);
  console.log(`📄 Agreement PDF uploaded to S3: s3://${BUCKET}/${key}`);
  return key;
}

/**
 * Generate a pre-signed URL that allows the holder to download the PDF for
 * a limited time (default: 1 hour).
 *
 * @param {string} s3Key       - The S3 object key returned by uploadAgreementPDF.
 * @param {number} expiresInSeconds - Seconds until the URL expires (default 3600).
 * @returns {Promise<string>}  - A temporary pre-signed HTTPS URL.
 */
async function getAgreementPDFUrl(s3Key, expiresInSeconds = 3600) {
  const client = _getClient();

  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });

  const url = await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
  return url;
}

/**
 * Check whether S3 is configured in this environment.
 * Used by controllers to skip S3 upload gracefully when credentials are absent.
 */
function isS3Configured() {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET
  );
}

/**
 * Upload a payment receipt PDF to S3.
 * @param {Buffer} pdfBuffer
 * @param {string} paymentId - MongoDB ObjectId string
 * @returns {Promise<string>} - The S3 object key
 */
async function uploadReceiptPDF(pdfBuffer, paymentId) {
  const client = _getClient();
  const year = new Date().getFullYear();
  const key = `receipts/${year}/${paymentId}/receipt.pdf`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
    Tagging: 'Type=PaymentReceipt',
    ServerSideEncryption: 'AES256',
    Metadata: { paymentId, uploadedAt: new Date().toISOString() },
  });

  await client.send(command);
  console.log(`🧾 Receipt PDF uploaded to S3: s3://${BUCKET}/${key}`);
  return key;
}

/**
 * Generate a pre-signed URL for a receipt PDF.
 * @param {string} s3Key
 * @param {number} expiresInSeconds
 * @returns {Promise<string>}
 */
async function getReceiptPDFUrl(s3Key, expiresInSeconds = 3600) {
  const client = _getClient();
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Upload a tenant document to S3.
 * @param {Buffer} fileBuffer
 * @param {string} userId
 * @param {string} originalName
 * @param {string} mimeType
 * @returns {Promise<string>} - The S3 object key
 */
async function uploadTenantDocument(fileBuffer, userId, originalName, mimeType) {
  const client = _getClient();
  const ts = Date.now().toString(36);
  const safeName = originalName.replace(/[^a-zA-Z0-9.\-_]/g, '');
  const key = `tenants/${userId}/documents/${ts}-${safeName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
    Tagging: 'Type=TenantDocument',
    ServerSideEncryption: 'AES256',
    Metadata: { userId, uploadedAt: new Date().toISOString() },
  });

  await client.send(command);
  console.log(`📄 Tenant document uploaded to S3: s3://${BUCKET}/${key}`);
  return key;
}

/**
 * Generate a pre-signed URL for a tenant document.
 * @param {string} s3Key
 * @param {number} expiresInSeconds
 * @returns {Promise<string>}
 */
async function getTenantDocumentUrl(s3Key, expiresInSeconds = 3600) {
  const client = _getClient();
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

module.exports = {
  uploadAgreementPDF,
  getAgreementPDFUrl,
  uploadReceiptPDF,
  getReceiptPDFUrl,
  uploadTenantDocument,
  getTenantDocumentUrl,
  isS3Configured
};
