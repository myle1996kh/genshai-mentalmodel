import { createClient } from "npm:@supabase/supabase-js@2";
import { getAIProviderConfig, makeAIChatRequest } from "../_shared/ai-provider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MEM0_API_URL = "https://api.mem0.ai/v1";

interface MemoryEntry {
  id: string;
  memory: string;
  created_at?: string;
  updated_at?: string;
  metadata?: Record<string, any>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const MEM0_API_KEY = Deno.env.get("MEM0_API_KEY");
    if (!MEM0_API_KEY) {
      console.error("MEM0_API_KEY not configured");
      return new Response(
        JSON.stringify({ success: false, error: "Memory service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { action, userId, advisorId, advisorType, messages, query } = await req.json();
    console.log("Memory manager:", action, "user:", userId, "advisor:", advisorId);

    const mem0Headers = {
      "Authorization": `Token ${MEM0_API_KEY}`,
      "Content-Type": "application/json",
    };

    if (action === "add") {
      // Add memories from conversation messages
      if (!messages || !userId) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing messages or userId" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const mem0Messages = messages.map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      }));

      const metadata: Record<string, any> = {};
      if (advisorId) metadata.advisor_id = advisorId;
      if (advisorType) metadata.advisor_type = advisorType;

      const response = await fetch(`${MEM0_API_URL}/memories/`, {
        method: "POST",
        headers: mem0Headers,
        body: JSON.stringify({
          messages: mem0Messages,
          user_id: userId,
          metadata,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Mem0 add error:", response.status, errText);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to add memories" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();
      console.log("Mem0 add result:", JSON.stringify(data).substring(0, 200));

      return new Response(
        JSON.stringify({ success: true, data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "search") {
      // Search memories relevant to a query
      if (!query || !userId) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing query or userId" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const response = await fetch(`${MEM0_API_URL}/memories/search/`, {
        method: "POST",
        headers: mem0Headers,
        body: JSON.stringify({
          query,
          user_id: userId,
          limit: 10,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Mem0 search error:", response.status, errText);
        return new Response(
          JSON.stringify({ success: false, memories: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();
      const memories: MemoryEntry[] = data.results || data || [];
      console.log("Mem0 search found:", memories.length, "memories");

      return new Response(
        JSON.stringify({ success: true, memories }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "get_all") {
      // Get all memories for a user
      if (!userId) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing userId" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const response = await fetch(`${MEM0_API_URL}/memories/?user_id=${userId}`, {
        method: "GET",
        headers: mem0Headers,
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("Mem0 get_all error:", response.status, errText);
        return new Response(
          JSON.stringify({ success: false, memories: [] }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const data = await response.json();
      const memories: MemoryEntry[] = data.results || data || [];

      return new Response(
        JSON.stringify({ success: true, memories }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "extract_profile") {
      // Use AI to extract user profile info from conversation
      if (!messages || !userId) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing messages or userId" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sbUrl = Deno.env.get("SUPABASE_URL")!;
      const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const aiConfig = await getAIProviderConfig(sbUrl, sbKey);
      console.log("Extract profile using provider:", aiConfig.provider);

      // Extract profile info using AI tool calling
      const conversationText = messages
        .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
        .join("\n");

      const response = await makeAIChatRequest(aiConfig, [
        {
          role: "system",
          content: "Extract user profile information from the conversation. Only extract what the user explicitly mentions about themselves.",
        },
        {
          role: "user",
          content: `Extract any user profile information from this conversation:\n\n${conversationText}`,
        },
      ], {
        stream: false,
        tools: [
          {
            type: "function",
            function: {
              name: "update_profile",
              description: "Update user profile with extracted information",
              parameters: {
                type: "object",
                properties: {
                  display_name: { type: "string", description: "User's name if mentioned" },
                  goals: { type: "array", items: { type: "string" }, description: "User's goals or objectives" },
                  challenges: { type: "array", items: { type: "string" }, description: "Challenges user is facing" },
                  interests: { type: "array", items: { type: "string" }, description: "Topics user is interested in" },
                  career_stage: { type: "string", description: "Career stage (student, early-career, mid-career, senior, founder, etc.)" },
                  industry: { type: "string", description: "Industry or field user works in" },
                },
                required: [],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "update_profile" } },
      });

      if (!response.ok) {
        console.error("AI extraction error:", response.status);
        return new Response(
          JSON.stringify({ success: false, error: "AI extraction failed" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const aiData = await response.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      
      if (!toolCall) {
        return new Response(
          JSON.stringify({ success: true, profile: null, message: "No profile info extracted" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let profileData;
      try {
        profileData = JSON.parse(toolCall.function.arguments);
      } catch {
        return new Response(
          JSON.stringify({ success: true, profile: null, message: "Failed to parse extraction" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Update profile in database
      const supabaseUrl2 = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey2 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl2, supabaseKey2);

      // Get existing profile
      const { data: existing } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        // Merge arrays, avoid duplicates
        const mergeArrays = (existing: string[] | null, newItems: string[] | undefined) => {
          if (!newItems || newItems.length === 0) return existing || [];
          const merged = new Set([...(existing || []), ...newItems]);
          return Array.from(merged);
        };

        const updates: Record<string, any> = {};
        if (profileData.display_name && !existing.display_name) updates.display_name = profileData.display_name;
        if (profileData.goals?.length) updates.goals = mergeArrays(existing.goals, profileData.goals);
        if (profileData.challenges?.length) updates.challenges = mergeArrays(existing.challenges, profileData.challenges);
        if (profileData.interests?.length) updates.interests = mergeArrays(existing.interests, profileData.interests);
        if (profileData.career_stage && !existing.career_stage) updates.career_stage = profileData.career_stage;
        if (profileData.industry && !existing.industry) updates.industry = profileData.industry;

        if (Object.keys(updates).length > 0) {
          updates.onboarding_completed = true;
          await supabase.from("user_profiles").update(updates).eq("user_id", userId);
          console.log("Profile updated:", Object.keys(updates));
        }
      } else {
        // Create new profile
        await supabase.from("user_profiles").insert({
          user_id: userId,
          display_name: profileData.display_name || null,
          goals: profileData.goals || [],
          challenges: profileData.challenges || [],
          interests: profileData.interests || [],
          career_stage: profileData.career_stage || null,
          industry: profileData.industry || null,
          onboarding_completed: true,
        });
        console.log("Profile created for user:", userId);
      }

      return new Response(
        JSON.stringify({ success: true, profile: profileData }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Unknown action. Use: add, search, get_all, extract_profile" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Memory manager error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
