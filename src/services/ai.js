// ============================================
// OpsTrainer 2.1 — DeepSeek AI Service
// Central AI wrapper used by all features
// ============================================
const fetch = require('node-fetch');

const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

/**
 * Core AI call — used by all features
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {object} options — { temperature, max_tokens, json_mode }
 */
async function callAI(systemPrompt, userMessage, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');

  const { temperature = 0.7, max_tokens = 4000, json_mode = false } = options;

  const body = {
    model: DEEPSEEK_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature,
    max_tokens,
    ...(json_mode ? { response_format: { type: 'json_object' } } : {})
  };

  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    timeout: 120000
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('DeepSeek returned empty response');

  return content;
}

/**
 * Chat with history — for AI Instructor
 * @param {string} systemPrompt
 * @param {Array} history — [{role, content}]
 * @param {string} userMessage
 */
async function callAIWithHistory(systemPrompt, history, userMessage, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');

  const { temperature = 0.7, max_tokens = 2000 } = options;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ];

  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, temperature, max_tokens }),
    timeout: 60000
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`DeepSeek API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

module.exports = { callAI, callAIWithHistory };
