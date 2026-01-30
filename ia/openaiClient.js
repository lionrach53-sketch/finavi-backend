const fetch = global.fetch || require('node-fetch');

async function getOpenAIAdvice(apiKey, prompt, model = 'gpt-3.5-turbo') {
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const body = {
    model,
    messages: [
      { role: 'system', content: 'You are a helpful, concise French-speaking financial coach. Give practical, empathetic, and actionable financial advice based on the user context.' },
      { role: 'user', content: prompt }
    ],
    max_tokens: 600,
    temperature: 0.7
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${text}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  return content;
}

module.exports = { getOpenAIAdvice };
