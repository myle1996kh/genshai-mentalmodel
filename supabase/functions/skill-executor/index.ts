/**
 * Skill Executor Edge Function
 * Executes AI-generated skills in a secure sandbox
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Execution timeout (5 seconds)
const EXECUTION_TIMEOUT = 5000;

// Memory limit (128MB)
const MEMORY_LIMIT = 128;

/**
 * Execute skill code in a secure Deno subprocess
 */
async function executeInSecureSandbox(
    code: string,
    input: any,
    timeout: number = EXECUTION_TIMEOUT
): Promise<{ output: any; executionTimeMs: number }> {
    const startTime = Date.now();

    // Create temporary file
    const tempFile = await Deno.makeTempFile({ suffix: '.js' });

    try {
        // Wrap code with input/output handling
        const wrappedCode = `
// Skill code
${code}

// Execute with input
try {
  const input = ${JSON.stringify(input)};
  const result = executeSkill(input);
  console.log(JSON.stringify({ success: true, output: result }));
} catch (error) {
  console.log(JSON.stringify({ 
    success: false, 
    error: error.message || 'Execution error' 
  }));
}
`;

        await Deno.writeTextFile(tempFile, wrappedCode);

        // Execute in isolated subprocess with ZERO permissions
        const command = new Deno.Command('deno', {
            args: [
                'run',
                '--no-prompt',
                '--no-remote',      // No network access
                '--no-read',        // No file read
                '--no-write',       // No file write
                '--no-env',         // No env vars
                '--no-run',         // No subprocess
                `--v8-flags=--max-old-space-size=${MEMORY_LIMIT}`,
                tempFile
            ],
            stdin: 'null',
            stdout: 'piped',
            stderr: 'piped',
        });

        const process = command.spawn();

        // Timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                process.kill('SIGKILL');
                reject(new Error(`Execution timeout (${timeout}ms)`));
            }, timeout);
        });

        // Wait for completion or timeout
        const result = await Promise.race([
            process.output(),
            timeoutPromise
        ]);

        const stdout = new TextDecoder().decode(result.stdout);
        const stderr = new TextDecoder().decode(result.stderr);

        if (stderr) {
            throw new Error(`Execution error: ${stderr}`);
        }

        // Parse result
        const parsed = JSON.parse(stdout);

        if (!parsed.success) {
            throw new Error(parsed.error || 'Execution failed');
        }

        const executionTimeMs = Date.now() - startTime;

        return {
            output: parsed.output,
            executionTimeMs
        };

    } finally {
        // Cleanup temp file
        try {
            await Deno.remove(tempFile);
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Simple in-memory cache
 */
const cache = new Map<string, { output: any; timestamp: number; executionTimeMs: number }>();
const CACHE_TTL = 3600 * 1000; // 1 hour

function getCacheKey(skillId: string, input: any): string {
    const inputStr = JSON.stringify(input);
    // Simple hash (for demo - use crypto in production)
    let hash = 0;
    for (let i = 0; i < inputStr.length; i++) {
        const char = inputStr.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `${skillId}:${hash}`;
}

serve(async (req) => {
    try {
        // CORS headers
        if (req.method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
                },
            });
        }

        // Parse request
        const { skillId, input, conversationId } = await req.json();

        // Get user from auth header
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) {
            throw new Error('Missing authorization header');
        }

        const { data: { user }, error: authError } = await supabase.auth.getUser(
            authHeader.replace('Bearer ', '')
        );

        if (authError || !user) {
            throw new Error('Unauthorized');
        }

        // Fetch skill from database
        const { data: skill, error: skillError } = await supabase
            .from('advisor_skills')
            .select('*')
            .eq('id', skillId)
            .eq('user_id', user.id)
            .eq('status', 'approved')
            .single();

        if (skillError || !skill) {
            throw new Error('Skill not found or not approved');
        }

        // Check cache
        const cacheKey = getCacheKey(skillId, input);
        const cached = cache.get(cacheKey);

        if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
            // Log cached execution
            await supabase.from('skill_executions').insert({
                skill_id: skillId,
                conversation_id: conversationId,
                user_id: user.id,
                input,
                output: cached.output,
                execution_time_ms: cached.executionTimeMs,
                success: true,
                cached: true
            });

            return new Response(
                JSON.stringify({
                    success: true,
                    output: cached.output,
                    executionTimeMs: cached.executionTimeMs,
                    cached: true
                }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    }
                }
            );
        }

        // Execute skill
        const { output, executionTimeMs } = await executeInSecureSandbox(
            skill.code,
            input,
            EXECUTION_TIMEOUT
        );

        // Cache result
        cache.set(cacheKey, { output, timestamp: Date.now(), executionTimeMs });

        // Cleanup old cache entries (simple LRU)
        if (cache.size > 1000) {
            const oldestKey = cache.keys().next().value as string;
            if (oldestKey) cache.delete(oldestKey);
        }

        // Log execution
        await supabase.from('skill_executions').insert({
            skill_id: skillId,
            conversation_id: conversationId,
            user_id: user.id,
            input,
            output,
            execution_time_ms: executionTimeMs,
            success: true,
            cached: false
        });

        // Increment usage count
        await supabase.rpc('increment_skill_usage', { p_skill_id: skillId });

        return new Response(
            JSON.stringify({
                success: true,
                output,
                executionTimeMs,
                cached: false
            }),
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            }
        );

    } catch (error) {
        console.error('Skill execution error:', error);

        // Log failed execution
        try {
            const { skillId, input, conversationId } = await req.json();
            const authHeader = req.headers.get('Authorization');
            if (authHeader) {
                const { data: { user } } = await supabase.auth.getUser(
                    authHeader.replace('Bearer ', '')
                );
                if (user) {
                    await supabase.from('skill_executions').insert({
                        skill_id: skillId,
                        conversation_id: conversationId,
                        user_id: user.id,
                        input,
                        success: false,
                        error_message: error instanceof Error ? error.message : 'Unknown error',
                        cached: false
                    });
                }
            }
        } catch {
            // Ignore logging errors
        }

        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            }),
            {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                }
            }
        );
    }
});
