import { getAIProviderConfig, makeAIChatRequest, withModel, getLovableConfig, getUserProviderOverride } from "../_shared/ai-provider.ts";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const requestBody = await req.json();
        const { prompt } = requestBody;

        if (!prompt) {
            return new Response(
                JSON.stringify({ error: "Prompt is required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log("Generating image with prompt:", prompt);

        // Check for user-level provider override (9router, direct) from request body
        const userOverride = getUserProviderOverride(requestBody);

        let imageConfig;
        let useModalities = true;

        if (userOverride) {
            // User has configured their own provider (e.g., 9router)
            imageConfig = userOverride;
            // Most 9router/direct providers don't support modalities parameter
            useModalities = false;
            console.log(`Using user override provider for image generation, model: ${userOverride.model}`);
        } else {
            // Fall back to admin settings or Lovable
            try {
                const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
                const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
                const aiConfig = await getAIProviderConfig(supabaseUrl, supabaseKey);

                // Determine which model to use for image generation
                const imageModel = aiConfig.imageModel || aiConfig.model;

                // Check if the configured provider supports image generation
                const supportsImages =
                    imageModel.includes('gemini') ||
                    imageModel.includes('image') ||
                    imageModel.includes('dalle') ||
                    imageModel.includes('midjourney');

                if (aiConfig.provider === 'direct' || aiConfig.provider === 'cliproxy') {
                    // Use the configured provider (9router, OpenRouter, etc.)
                    if (supportsImages) {
                        imageConfig = withModel(aiConfig, imageModel);
                        console.log(`Using ${aiConfig.provider} provider for image generation, model: ${imageModel}`);
                    } else {
                        // Configured provider doesn't support images, fall back to Lovable
                        console.warn(`Configured model ${imageModel} may not support images, falling back to Lovable`);
                        const lovableConfig = getLovableConfig();
                        const fallbackModel = 'google/gemini-2.5-flash-image';
                        imageConfig = withModel(lovableConfig, fallbackModel);
                        console.log("Falling back to Lovable gateway for image generation, model:", fallbackModel);
                    }
                } else {
                    // Provider is 'lovable' or fallback
                    const lovableConfig = getLovableConfig();
                    const model = aiConfig.imageModel || 'google/gemini-2.5-flash-image';
                    imageConfig = withModel(lovableConfig, model);
                    console.log("Using Lovable gateway for image generation, model:", model);
                }
            } catch (error) {
                console.error("Failed to configure image generation:", error);
                // Last resort fallback to Lovable
                try {
                    const lovableConfig = getLovableConfig();
                    imageConfig = withModel(lovableConfig, 'google/gemini-2.5-flash-image');
                    console.log("Error occurred, using Lovable fallback");
                } catch {
                    return new Response(
                        JSON.stringify({ error: "Image generation unavailable. Please check your AI provider configuration." }),
                        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }
            }
        }

        const response = await makeAIChatRequest(imageConfig, [
            { role: "user", content: prompt }
        ], {
            stream: false,
            modalities: useModalities ? ["image", "text"] : undefined,
            functionName: 'generate-image',
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("Image generation failed:", response.status, errorText);

            if (response.status === 429) {
                return new Response(
                    JSON.stringify({ error: "Rate limited. Please try again later." }),
                    { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            if (response.status === 402) {
                return new Response(
                    JSON.stringify({ error: "Insufficient credits. Please add funds or configure a different image model." }),
                    { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }

            return new Response(
                JSON.stringify({ error: "Image generation failed", details: errorText.slice(0, 200) }),
                { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const data = await response.json();

        // Try multiple response formats
        // Format 1: Lovable gateway style (images array)
        let imageUrl = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;

        // Format 2: OpenAI/OpenRouter style (base64 in content or inline)
        if (!imageUrl) {
            const content = data.choices?.[0]?.message?.content;
            if (content && typeof content === 'string') {
                // Check if content itself is a data URL
                if (content.startsWith('data:image')) {
                    imageUrl = content;
                }
                // Check for markdown image
                const mdMatch = content.match(/!\[.*?\]\((data:image[^)]+)\)/);
                if (mdMatch) {
                    imageUrl = mdMatch[1];
                }
            }
            // Format 3: content is array with image parts
            if (!imageUrl && Array.isArray(data.choices?.[0]?.message?.content)) {
                const imagePart = data.choices[0].message.content.find(
                    (p: any) => p.type === 'image_url' || p.type === 'image'
                );
                if (imagePart?.image_url?.url) {
                    imageUrl = imagePart.image_url.url;
                }
            }
        }

        if (!imageUrl) {
            console.error("No image in response:", JSON.stringify(data).slice(0, 500));
            return new Response(
                JSON.stringify({ error: "No image URL returned. The model may not support image generation.", responsePreview: JSON.stringify(data).slice(0, 300) }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        console.log("Image generated successfully");

        return new Response(
            JSON.stringify({ url: imageUrl }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    } catch (error) {
        console.error("Error in generate-image function:", error);
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
