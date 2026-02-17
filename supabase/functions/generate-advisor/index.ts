import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { compileCognitiveBlueprint } from "../_shared/blueprint-compiler.ts";
import type { CognitiveBlueprint } from "../_shared/blueprint-compiler.ts";
import { getAIProviderConfig, makeAIChatRequest } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BLUEPRINT_SCHEMA = `{
  "worldview": {
    "core_axioms": ["3-5 fundamental beliefs that shape how this advisor sees everything"],
    "ontology": "One paragraph: How does this advisor see reality? What is their fundamental model of how the world works?",
    "epistemology": "How do they believe truth is discovered? Through experience? Logic? Intuition? Data?"
  },
  "diagnostic_pattern": {
    "perceptual_filters": ["When someone presents a problem, what does this advisor notice FIRST? What lens do they see through? 3-4 items"],
    "signature_questions": ["The 2-4 questions this advisor instinctively asks to understand any situation"],
    "red_flags": ["What patterns in someone's thinking would concern this advisor? 2-3 items"]
  },
  "reasoning_chain": {
    "method": "Name of their core reasoning approach",
    "steps": ["The ordered sequence of how they think through problems — from first perception to conclusion. 4-6 steps"],
    "heuristics": ["Rules of thumb or mental shortcuts they apply. 3-5 items"]
  },
  "emotional_stance": {
    "archetype": "One of: tough_love, warm_wisdom, provocative_challenge, calm_analysis, energetic_motivation",
    "relationship_to_user": "How do they see their role relative to the person they're helping? One sentence.",
    "tone_markers": ["3-5 adjectives describing how they communicate"]
  },
  "anti_patterns": ["3-5 things this advisor would NEVER recommend or do"],
  "language_dna": {
    "metaphor_domains": ["What domains do they naturally draw metaphors from? e.g., nature, warfare, sports, cooking. 3-4 items"],
    "signature_phrases": ["3-5 characteristic phrases or sayings"],
    "vocabulary_level": "One of: simple, accessible, technical, academic",
    "sentence_rhythm": "One of: short_punchy, flowing_narrative, questioning, structured"
  }
}`;

const generatePromptForType = (type: string, input: Record<string, string>) => {
  const blueprintInstruction = `\n\nALSO generate a "cognitive_blueprint" field following this EXACT structure:\n${BLUEPRINT_SCHEMA}\n\nThe cognitive blueprint is the BRAIN of this advisor — how they actually think, not just what they know. Make it specific and authentic.`;

  switch (type) {
    case "persona":
      return `You are an expert at creating AI persona profiles. Given the name "${input.name}", generate a complete persona profile.

Return a JSON object with these exact fields:
- name: The person's full name
- title: A short professional title/role (e.g., "Visionary Entrepreneur", "Stoic Philosopher")
- description: 1-2 sentence description of who they are and why they're interesting to learn from
- avatar: A single emoji that best represents them
- color: A Tailwind CSS gradient string (e.g., "from-purple-500 to-indigo-700")
- system_prompt: A detailed system prompt (200-400 words) that makes an AI embody this person. Include their key philosophies, communication style, famous quotes, and how they think. Write in second person ("You ARE [name]...")
- response_style: One of: "concise", "balanced", "detailed", "socratic", "storytelling"
- tags: Array of 3-5 relevant topic tags
- wiki_url: Their Wikipedia URL if they're a known figure, or empty string
- source_type: "persona"
- cognitive_blueprint: A structured JSON object (see below)

Be accurate to the real person's philosophy and communication style.

For the cognitive_blueprint, think deeply about HOW this person actually thinks:
- Their worldview should reflect their actual philosophical positions
- Their diagnostic pattern should reflect how they'd approach a real conversation
- Their reasoning chain should capture their actual intellectual method
- Their emotional stance should match their known personality
- Their anti-patterns should reflect what they genuinely opposed
- Their language DNA should capture their actual communication style${blueprintInstruction}`;

    case "book":
      return `You are an expert at creating AI book advisor profiles. Given the book "${input.title}"${input.author ? ` by ${input.author}` : ''}, generate a complete book profile.

Return a JSON object with these exact fields:
- title: The book's full title
- author: The author's name
- description: 1-2 sentence description of the book and its core message
- cover_emoji: A single emoji that represents the book's theme
- color: A Tailwind CSS gradient string (e.g., "from-amber-500 to-orange-700")
- system_prompt: A detailed system prompt (200-400 words) that makes an AI embody this book's wisdom. Include the key teachings, core concepts, and how to guide users through the material. The AI should speak as a wise guide who deeply understands this book.
- key_concepts: Array of 5-8 key concepts/teachings from the book
- genres: Array of 2-3 genres (e.g., "Self-Help", "Philosophy", "Psychology", "Business", "Spirituality")
- language: "${input.language || 'en'}"
- wiki_url: The book's Wikipedia or Goodreads URL if known, or empty string
- cognitive_blueprint: A structured JSON object (see below)

Be accurate to the book's actual content and teachings.

For the cognitive_blueprint, capture the book's THINKING METHODOLOGY:
- Worldview: The book's fundamental thesis about how the world works
- Diagnostic pattern: How the book teaches you to see problems differently
- Reasoning chain: The book's core methodology or framework for thinking
- Emotional stance: The book's tone and relationship to the reader
- Anti-patterns: What the book warns against
- Language DNA: The book's characteristic style and metaphors${blueprintInstruction}`;

    case "framework":
      return `You are an expert at creating mental model/thinking framework profiles. Given the framework "${input.name}", generate a complete framework profile.

Return a JSON object with these exact fields:
- name: The framework's name
- title: A short subtitle explaining what it does (e.g., "Break down to fundamentals")
- description: 1-2 sentence description of this thinking framework
- icon: A single emoji that represents the framework
- color: A Tailwind CSS gradient string (e.g., "from-blue-500 to-cyan-700")
- system_prompt: A detailed system prompt (200-400 words) that makes an AI an expert in this framework. Include the core principles, how to apply it step-by-step, common pitfalls, and when to use it. The AI should guide users to apply this framework to their specific problems.
- mental_models: Array of 4-6 related mental models or sub-concepts within this framework
- example_questions: Array of 3-5 example questions a user might ask when using this framework
- cognitive_blueprint: A structured JSON object (see below)

Be thorough and accurate about the framework's methodology.

For the cognitive_blueprint, this is the framework's OPERATIONAL BRAIN:
- Worldview: The assumptions that make this framework work
- Diagnostic pattern: How this framework teaches you to see and analyze problems
- Reasoning chain: The step-by-step process of APPLYING this framework
- Emotional stance: How a master of this framework communicates
- Anti-patterns: Common mistakes or misapplications of this framework
- Language DNA: The terminology and metaphors native to this framework${blueprintInstruction}`;

    default:
      throw new Error(`Unknown advisor type: ${type}`);
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, input } = await req.json();

    if (!type || !input) {
      return new Response(
        JSON.stringify({ error: "Missing type or input" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const aiConfig = await getAIProviderConfig(supabaseUrl, supabaseKey);
    console.log("Generate advisor using provider:", aiConfig.provider, "model:", aiConfig.model);

    const userPrompt = generatePromptForType(type, input);

    const response = await makeAIChatRequest(aiConfig, [
      {
        role: "system",
        content: "You are a JSON generator that creates deeply authentic AI advisor profiles. Always respond with valid JSON only, no markdown, no code blocks, no extra text. Just the raw JSON object. The cognitive_blueprint field must be a valid JSON object (not a string).",
      },
      { role: "user", content: userPrompt },
    ], { stream: false });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required, please add funds." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(JSON.stringify({ error: "No content from AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Clean up response - strip <think> tags and markdown code blocks
    let cleanContent = content.trim();
    cleanContent = cleanContent.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    if (cleanContent.startsWith("```")) {
      cleanContent = cleanContent.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    // Extract JSON object between first { and last }
    const jsonStart = cleanContent.indexOf("{");
    const jsonEnd = cleanContent.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleanContent = cleanContent.slice(jsonStart, jsonEnd + 1);
    }

    const generated = JSON.parse(cleanContent);

    // If blueprint exists, compile it and use as the system_prompt fallback
    // This ensures system_prompt is always a usable compiled version of the blueprint
    if (generated.cognitive_blueprint && typeof generated.cognitive_blueprint === "object") {
      try {
        const name = generated.name || generated.title || input.name || input.title;
        const compiled = compileCognitiveBlueprint(
          generated.cognitive_blueprint as CognitiveBlueprint,
          name,
          type as "persona" | "framework" | "book"
        );
        // Replace system_prompt with the compiled blueprint version
        // so that even without the blueprint, the system_prompt is high quality
        generated.system_prompt = compiled;
        console.log("Blueprint generated and compiled for:", name);
      } catch (e) {
        console.error("Blueprint compilation warning (keeping original system_prompt):", e);
      }
    }

    return new Response(JSON.stringify({ generated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Generate advisor error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
