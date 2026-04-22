// ============================================
// OpsTrainer 2.1 — DeepSeek AI Service
// ============================================
const fetch = require('node-fetch');

const DEEPSEEK_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

async function callAI(systemPrompt, userMessage, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');

  const { temperature = 0.7, max_tokens = 3000, json_mode = false } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180000); // 3 min

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        temperature,
        max_tokens,
        ...(json_mode ? { response_format: { type: 'json_object' } } : {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error('DeepSeek API error ' + response.status + ': ' + err);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('DeepSeek returned empty response');
    return content;

  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('DeepSeek request timed out after 3 minutes. Try reducing the number of modules or lessons.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function callAIWithHistory(systemPrompt, history, userMessage, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');

  const { temperature = 0.7, max_tokens = 2000 } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000); // 90 sec

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: userMessage }
        ],
        temperature,
        max_tokens
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error('DeepSeek API error ' + response.status + ': ' + err);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';

  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('AI request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { callAI, callAIWithHistory };
