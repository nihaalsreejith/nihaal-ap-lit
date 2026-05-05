import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Groq from 'groq-sdk';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'ap_lit_practice_site.html')));

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

function parseGroqJson(content) {
  const clean = content.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ── POST /api/generate-test ──────────────────────────────────────
// Split into two parallel calls: MCQ sets + FRQs, then combine.
app.post('/api/generate-test', async (req, res) => {
  const sysBase = `You generate original AP Literature practice test content. Return ONLY valid JSON — no markdown fences, no preamble, nothing else. Every passage must be entirely original fiction you write — no excerpts from any real published work, no real authors, no recognizable characters or plots.`;

  const mcqPrompt = `Generate the 5 MCQ passage sets for an AP Literature practice test. Return ONLY this JSON:
{
  "sets": [
    {
      "title": "...",
      "type": "prose" | "poetry",
      "text": "full passage — \\n\\n between prose paragraphs, \\n between poetry lines",
      "questions": [
        {
          "num": 1,
          "stem": "question referencing a specific phrase or image from this passage",
          "choices": { "A": "...", "B": "...", "C": "...", "D": "..." },
          "correct": "A" | "B" | "C" | "D",
          "explanation": "one sentence citing specific passage language",
          "distractors": { "[wrong letters]": "specific passage-based reason this fails" }
        }
      ]
    }
  ]
}

Requirements:
- 5 sets total: sets 0 and 2 prose, sets 1 and 3 poetry, set 4 your choice
- Prose: 400-600 words, 4 paragraphs, tonal shift between paragraphs 2 and 3
- Poetry: 20-40 lines, contains a volta, grounded in concrete specific imagery
- Exactly 11 questions per set, numbered 1-55 sequentially across all sets
- Each stem must reference a specific line, phrase, or image from that passage — not generic
- Distribute correct answers unevenly across A/B/C/D — never a repeating cycle
- Distractors must be passage-specific, not generic filler phrases
- Cover varied types per set: at least 2 tone/attitude, 2 imagery/figurative language, 1 structure/syntax, 1 theme, 1 diction; 4 your choice`;

  const frqPrompt = `Generate the 3 FRQ prompts for an AP Literature practice test. Return ONLY this JSON:
{
  "frqs": [
    { "kind": "Q1 Poetry Analysis", "passage": "original poem you write — 20-40 lines", "prompt": "specific prompt naming 2 literary elements present in this poem, ending with 'contribute to an interpretation of the poem as a whole.'" },
    { "kind": "Q2 Prose Fiction Analysis", "passage": "original prose passage you write — 400-500 words", "prompt": "specific prompt referencing this passage's situation and at least one literary element, ending with 'contribute to the meaning of the work as a whole.'" },
    { "kind": "Q3 Literary Argument", "passage": "", "prompt": "a thematic lens prompt that instructs the student to select a work of literary merit of their own choice and write an essay arguing how [the lens] contributes to the meaning of the work as a whole." }
  ]
}

Requirements:
- Q1 passage is an original poem you write — 20-40 lines, contains a volta
- Q2 passage is original prose fiction you write — 400-500 words
- Q3 has no passage — prompt must instruct student to select a work of literary merit of their own choice — never name a specific book`;

  try {
    const [mcqResult, frqResult] = await Promise.all([
      groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: sysBase },
          { role: 'user', content: mcqPrompt }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 8192,
        temperature: 0.8
      }),
      groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: sysBase },
          { role: 'user', content: frqPrompt }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 8192,
        temperature: 0.8
      })
    ]);

    const mcqData = parseGroqJson(mcqResult.choices[0].message.content);
    const frqData = parseGroqJson(frqResult.choices[0].message.content);

    res.json({ sets: mcqData.sets || [], frqs: frqData.frqs || [] });
  } catch (err) {
    console.error('generate-test error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/grade-frqs ─────────────────────────────────────────
app.post('/api/grade-frqs', async (req, res) => {
  const { mcqScore, frqs, frqAnswers } = req.body;

  const systemPrompt = `You are an AP English Literature exam scorer. Use the official AP rubric:
Row A (Thesis, 0-1): Award 1 for a defensible, specific interpretation that requires textual defense. Never award for plot summary, prompt restatement, or vague generalization.
Row B (Evidence and Commentary, 0-4): 1=mostly general evidence, summary commentary. 2=some specific evidence, some explanation but no line of reasoning. 3=specific evidence throughout, commentary explains how evidence supports a line of reasoning, analyzes at least one technique. 4=consistently specific evidence, commentary explains how multiple techniques contribute to meaning across a sustained argument.
Row C (Sophistication, 0-1): Award 1 only for: exploring tensions/complexities, situating in broader context, accounting for alternatives, or consistently vivid persuasive style. Never award for a single mention or sweeping generalization.
Return ONLY valid JSON — no markdown, no preamble.`;

  const userPrompt = `Grade these three AP Literature essays. Return ONLY this JSON:
{
  "q1": { "row_a": {"score":0,"justification":"..."}, "row_b": {"score":0,"justification":"..."}, "row_c": {"score":0,"justification":"..."}, "total":0, "strengths":"2-3 sentences on specific strong moves", "areas":"2-3 sentences on clearest gap and how to close it" },
  "q2": { "row_a": {"score":0,"justification":"..."}, "row_b": {"score":0,"justification":"..."}, "row_c": {"score":0,"justification":"..."}, "total":0, "strengths":"2-3 sentences on specific strong moves", "areas":"2-3 sentences on clearest gap and how to close it" },
  "q3": { "row_a": {"score":0,"justification":"..."}, "row_b": {"score":0,"justification":"..."}, "row_c": {"score":0,"justification":"..."}, "total":0, "strengths":"2-3 sentences on specific strong moves", "areas":"2-3 sentences on clearest gap and how to close it" },
  "mcq_analysis": "2-3 sentences on MCQ performance based on ${mcqScore}/55",
  "overall_strengths": "2-3 sentences on strongest patterns across all essays",
  "overall_focus": "1-2 sentences on single most important improvement area",
  "readiness_pct": 0
}

Q1 — Poetry Analysis
PROMPT: ${(frqs && frqs[0]) ? frqs[0].prompt : ''}
ESSAY: ${(frqAnswers && frqAnswers[0]) ? frqAnswers[0] : '[no response]'}

Q2 — Prose Fiction Analysis
PROMPT: ${(frqs && frqs[1]) ? frqs[1].prompt : ''}
ESSAY: ${(frqAnswers && frqAnswers[1]) ? frqAnswers[1] : '[no response]'}

Q3 — Literary Argument (student's book of choice)
PROMPT: ${(frqs && frqs[2]) ? frqs[2].prompt : ''}
ESSAY: ${(frqAnswers && frqAnswers[2]) ? frqAnswers[2] : '[no response]'}`;

  try {
    const result = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: 8000,
      temperature: 0.8
    });

    const parsed = parseGroqJson(result.choices[0].message.content);
    res.json(parsed);
  } catch (err) {
    console.error('grade-frqs error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nnihaal.ai running → http://localhost:${PORT}`);
  console.log(`Groq key: ${process.env.GROQ_API_KEY ? '✓ loaded' : '✗ missing — set GROQ_API_KEY in .env'}\n`);
});
