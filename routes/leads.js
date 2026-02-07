import express from 'express';
import Joi from 'joi';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js'
import axios from 'axios';
import 'dotenv/config'

const router = express.Router();

// Config
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Validation
const leadSchema = Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    description: Joi.string().required(),
    phone: Joi.string().allow('', null),
    business_type: Joi.string().optional(),
    preferred_language: Joi.string().default('English')
});

async function callGemini(prompt) {
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash", 
        generationConfig: { responseMimeType: "application/json" }
    });
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
}

router.post('/process', async (req, res) => {
    try {
        const { error, value: inputData } = leadSchema.validate(req.body);
        if (error) return res.status(400).json({ error: error.details[0].message });

        // 1. AI Extraction & Strategy
        const analysis = await callGemini(`
            Analyze this lead for Advancify: ${JSON.stringify(inputData)}.
            Return JSON: industry, decision (good_fit|not_a_fit), confidence, justification.
        `);

        // 2. AI Email Writing (Adel Persona)
        let emailContent = null;
        if (analysis.decision !== 'not_a_fit') {
            emailContent = await callGemini(`
                Persona: Adel, Senior Growth Strategist. Write a B2B email to ${inputData.name}.
                Language: ${inputData.preferred_language}. Return JSON: subject, body (HTML).
            `);
        }

        // 3. Save to Supabase & Send Email
        await Promise.all([
            supabase.from('leads').insert([{
                name: inputData.name,
                email: inputData.email,
                decision: analysis.decision,
                subject: emailContent?.subject || 'N/A'
            }]),
            emailContent ? sendMail(inputData.email, emailContent) : Promise.resolve()
        ]);

        res.json({ success: true, analysis });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed" });
    }
});

// Helper for Microsoft Graph Email
async function sendMail(to, content) {
    // We get a token using Client Credentials (App Context)
    const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
    const params = new URLSearchParams();
    params.append('client_id', process.env.CLIENT_ID);
    params.append('client_secret', process.env.CLIENT_SECRET);
    params.append('scope', 'https://graph.microsoft.com/.default');
    params.append('grant_type', 'client_credentials');

    const tokenRes = await axios.post(tokenUrl, params);
    const accessToken = tokenRes.data.access_token;

    return axios.post(
        `https://graph.microsoft.com/v1.0/users/${process.env.SENDER_EMAIL_ADDRESS}/sendMail`,
        {
            message: {
                subject: content.subject,
                body: { contentType: 'HTML', content: content.body },
                toRecipients: [{ emailAddress: { address: to } }]
            }
        },
        { headers: { Authorization: `Bearer ${accessToken}` } }
    );
}

export default router;