const express = require('express');
const crypto = require('crypto');
const {
  saveApplicationRecord,
  getApplicationById,
  listApplications,
  storeUploadedFile,
  getFileStream,
} = require('../services/newBrightWaterGrantStorage');

function trimValue(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function encodeFileNameRFC5987(value = '') {
  return encodeURIComponent(value).replace(/'/g, '%27').replace(/\*/g, '%2A');
}

module.exports = function createNewBrightWaterGrantRouter({ stripe, appBaseUrl, hasStripeSecret }) {
  const router = express.Router();
  const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB per file
  const MAX_TOTAL_SIZE = 11 * 1024 * 1024; // ~14.6 MB after base64 encoding
  const MAX_FILES = 5;

  router.post('/applications', async (req, res) => {
    try {
      const fields = req.body?.fields && typeof req.body.fields === 'object' ? req.body.fields : {};
      const files = Array.isArray(req.body?.files) ? req.body.files : [];

      const requiredFields = [
        'first-name',
        'last-name',
        'email',
        'phone',
        'website',
        'social',
        'prior',
        'business-type',
        'customer-clarity',
        'brand-stage',
        'online-presence',
        'audience-size',
        'reviews',
        'revenue',
        'years',
        'grant-use',
        'business-description',
        'community',
        'referral',
      ];

      const applicant = {};
      for (const [key, value] of Object.entries(fields)) {
        applicant[key] = trimValue(value);
      }

      for (const field of requiredFields) {
        if (!applicant[field]) {
          return res.status(400).json({ ok: false, error: 'missing_field', field });
        }
      }

      const applicationId = crypto.randomUUID();
      const submittedAt = new Date().toISOString();

      const storedFiles = [];
      let processedFiles = 0;
      let totalBytes = 0;
      for (const file of files) {
        if (processedFiles >= MAX_FILES) break;
        if (!file || typeof file !== 'object') continue;
        const { name = '', type = 'application/octet-stream', size = 0, data = '' } = file;
        if (!data) continue;

        const buffer = Buffer.from(String(data), 'base64');
        if (buffer.length > MAX_FILE_SIZE) {
          return res.status(400).json({ ok: false, error: 'file_too_large', fileName: name });
        }

        totalBytes += buffer.length;
        if (totalBytes > MAX_TOTAL_SIZE) {
          return res.status(400).json({ ok: false, error: 'total_upload_too_large' });
        }

        const fileId = crypto.randomUUID();
        const metadata = await storeUploadedFile({
          applicationId,
          fileId,
          buffer,
          contentType: type,
          originalName: name,
        });
        storedFiles.push(metadata);
        processedFiles += 1;
      }

      const record = {
        id: applicationId,
        submittedAt,
        status: 'pending_fee',
        applicant,
        files: storedFiles,
        payment: {
          checkoutSessionId: null,
          checkoutUrl: null,
          createdAt: null,
          error: null,
        },
      };

      await saveApplicationRecord(record);

      let checkoutUrl = null;
      if (hasStripeSecret && stripe?.checkout?.sessions?.create) {
        try {
          const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card', 'link'],
            allow_promotion_codes: false,
            line_items: [
              {
                price_data: {
                  currency: 'usd',
                  product_data: {
                    name: 'New Bright Water Grant Application Fee',
                  },
                  unit_amount: 1900,
                },
                quantity: 1,
              },
            ],
            metadata: {
              applicationId,
              applicantEmail: applicant.email,
            },
            success_url: `${appBaseUrl}/delocoTech/new-bright-water-grant.html?status=success&application=${applicationId}`,
            cancel_url: `${appBaseUrl}/delocoTech/new-bright-water-grant.html?status=cancel&application=${applicationId}`,
          });

          checkoutUrl = session?.url || null;
          record.payment.checkoutSessionId = session?.id || null;
          record.payment.checkoutUrl = checkoutUrl;
          record.payment.createdAt = new Date().toISOString();
          record.status = 'awaiting_payment';
          await saveApplicationRecord(record);
        } catch (error) {
          record.payment.error = error?.message || 'Stripe checkout failed';
          record.status = 'payment_error';
          await saveApplicationRecord(record);
        }
      }

      return res.json({ ok: true, applicationId, checkoutUrl, hasStripe: Boolean(hasStripeSecret) });
    } catch (error) {
      console.error('new bright water application submission failed', error);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.get('/applications', async (req, res) => {
    try {
      const applications = await listApplications();
      const formatted = applications.map(application => ({
        ...application,
        files: (application.files || []).map(file => ({
          id: file.id,
          fileName: file.fileName,
          mimeType: file.mimeType,
          size: file.size,
          uploadedAt: file.uploadedAt,
          downloadUrl: `/api/new-bright-water-grant/applications/${application.id}/files/${file.id}`,
        })),
      }));
      res.json({ ok: true, applications: formatted });
    } catch (error) {
      console.error('new bright water list error', error);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.get('/applications/:id', async (req, res) => {
    try {
      const application = await getApplicationById(req.params.id);
      if (!application) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      const formatted = {
        ...application,
        files: (application.files || []).map(file => ({
          id: file.id,
          fileName: file.fileName,
          mimeType: file.mimeType,
          size: file.size,
          uploadedAt: file.uploadedAt,
          downloadUrl: `/api/new-bright-water-grant/applications/${application.id}/files/${file.id}`,
        })),
      };

      res.json({ ok: true, application: formatted });
    } catch (error) {
      console.error('new bright water detail error', error);
      res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  router.get('/applications/:id/files/:fileId', async (req, res) => {
    try {
      const filePayload = await getFileStream(req.params.id, req.params.fileId);
      if (!filePayload) {
        return res.status(404).end();
      }

      const { stream, contentType, contentLength, fileName } = filePayload;
      res.setHeader('Content-Type', contentType || 'application/octet-stream');
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      if (fileName) {
        const encoded = encodeFileNameRFC5987(fileName);
        res.setHeader('Content-Disposition', `inline; filename="${encoded}"; filename*=UTF-8''${encoded}`);
      }

      if (stream?.pipe) {
        stream.pipe(res);
        stream.on('error', () => res.destroy());
      } else {
        res.end();
      }
    } catch (error) {
      console.error('new bright water file download error', error);
      res.status(500).end();
    }
  });

  return router;
};
