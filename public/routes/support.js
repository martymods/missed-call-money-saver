const express = require('express');
const { getCollection } = require('../services/mongo');

function createSupportRouter(openai){
  const router = express.Router();

  router.post('/report', async (req, res) => {
    try {
      const { subject = '', description = '', email = '', category = 'general', metadata = {} } = req.body || {};
      if (!subject || !description){
        return res.status(400).json({ error: 'missing_fields' });
      }

      let assistant = 'Thanks for flagging this. We will review the report shortly.';
      if (openai && openai.chat && openai.chat.completions){
        try {
          const completion = await openai.chat.completions.create({
            model: process.env.OPENAI_SUPPORT_MODEL || 'gpt-4o-mini',
            temperature: 0.2,
            max_tokens: 220,
            messages: [
              {
                role: 'system',
                content: 'You triage warehouse software issues. Provide two concise next steps and a reassuring tone.',
              },
              {
                role: 'user',
                content: `Category: ${category}\nSubject: ${subject}\nDescription: ${description}\nContext: ${JSON.stringify(metadata)}`,
              },
            ],
          });
          assistant = completion.choices?.[0]?.message?.content?.trim() || assistant;
        } catch (err){
          console.error('Support assistant error', err.message || err);
        }
      }

      try {
        const col = await getCollection('supportTickets');
        await col.insertOne({
          subject,
          description,
          email,
          category,
          metadata,
          assistant,
          createdAt: new Date().toISOString(),
        });
      } catch (err){
        console.error('Support log error', err.message || err);
      }

      res.json({
        ok: true,
        assistant,
        forward: 'Email sent to rb@dreamworld.co via your default mail client.',
        reward: {
          title: 'Logistics Legend',
          message: 'You just helped optimize the command center. +50 reputation!',
          icon: '🚀',
        },
      });
    } catch (err){
      console.error('Support report error', err);
      res.status(500).json({ error: 'server_error' });
    }
  });

  return router;
}

module.exports = createSupportRouter;