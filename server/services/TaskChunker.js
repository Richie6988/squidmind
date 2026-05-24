/**
 * Task Chunker - Intelligent Task Splitting & Token Optimization
 * 
 * Core Philosophy:
 * - Break big tasks into small, manageable chunks
 * - Optimize LLM outputs to save tokens
 * - Chain small tasks efficiently
 * - Maximum efficiency, minimum cost
 * 
 * This is SquidMind's secret sauce - making us MORE efficient than OpenClaw
 */

class TaskChunker {
  constructor() {
    // Token limits per model
    this.tokenLimits = {
      'claude-opus-4': 200000,
      'claude-sonnet-4': 200000,
      'claude-haiku-4': 200000,
      'local_gguf': 4096  // Conservative default for local models
    };
    
    // Optimal chunk sizes (in tokens)
    this.optimalChunkSize = 500;
    
    // Task splitting strategies
    this.strategies = {
      'code_review': this.splitCodeReview.bind(this),
      'data_analysis': this.splitDataAnalysis.bind(this),
      'document_writing': this.splitDocumentWriting.bind(this),
      'research': this.splitResearch.bind(this),
      'default': this.splitDefault.bind(this)
    };
  }

  /**
   * Analyze task and determine if chunking is needed
   */
  async analyzeTask(input, taskType = 'default') {
    const estimatedTokens = this.estimateTokens(input);
    
    return {
      estimated_tokens: estimatedTokens,
      needs_chunking: estimatedTokens > this.optimalChunkSize,
      recommended_chunks: Math.ceil(estimatedTokens / this.optimalChunkSize),
      task_type: taskType,
      strategy: this.strategies[taskType] ? taskType : 'default'
    };
  }

  /**
   * Estimate tokens (rough approximation: 1 token ≈ 4 characters)
   */
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Split task into optimized chunks
   */
  async splitTask(input, taskType = 'default', options = {}) {
    const analysis = await this.analyzeTask(input, taskType);
    
    if (!analysis.needs_chunking) {
      return [{ chunk_id: 1, input, type: 'full' }];
    }

    // Use appropriate splitting strategy
    const strategy = this.strategies[analysis.strategy];
    const chunks = await strategy(input, options);

    console.log(`📊 Task split into ${chunks.length} chunks (${analysis.estimated_tokens} tokens)`);

    return chunks;
  }

  /**
   * Code Review Splitting Strategy
   */
  async splitCodeReview(input, options) {
    // Split by:
    // 1. Files (if multiple files)
    // 2. Functions/classes
    // 3. Concerns (security, performance, style)

    const chunks = [];
    
    // Check if input contains multiple files
    const fileMatches = input.match(/```[\w]*\n[\s\S]+?```/g);
    
    if (fileMatches && fileMatches.length > 1) {
      // Split by file
      fileMatches.forEach((file, i) => {
        chunks.push({
          chunk_id: i + 1,
          input: `Review this code for bugs, security issues, and style:\n\n${file}`,
          type: 'file',
          context: `File ${i + 1} of ${fileMatches.length}`
        });
      });
    } else {
      // Split by concern
      const concerns = ['security', 'bugs', 'performance', 'style'];
      concerns.forEach((concern, i) => {
        chunks.push({
          chunk_id: i + 1,
          input: `Review this code specifically for ${concern} issues:\n\n${input}`,
          type: 'concern',
          context: `Focus: ${concern}`
        });
      });
    }

    return chunks;
  }

  /**
   * Data Analysis Splitting Strategy
   */
  async splitDataAnalysis(input, options) {
    // Split by:
    // 1. Data sections
    // 2. Analysis steps (clean → analyze → visualize)
    // 3. Size (chunk large datasets)

    const chunks = [];
    const steps = [
      {
        step: 'validation',
        prompt: 'Validate this data for completeness, format, and quality issues'
      },
      {
        step: 'cleaning',
        prompt: 'Clean this data: fix missing values, remove duplicates, handle outliers'
      },
      {
        step: 'analysis',
        prompt: 'Analyze this cleaned data: find patterns, trends, correlations'
      },
      {
        step: 'insights',
        prompt: 'Extract key insights and actionable recommendations from this data'
      }
    ];

    steps.forEach((step, i) => {
      chunks.push({
        chunk_id: i + 1,
        input: `${step.prompt}:\n\n${input}`,
        type: 'step',
        context: `Step: ${step.step}`,
        depends_on: i > 0 ? i : null  // Sequential dependency
      });
    });

    return chunks;
  }

  /**
   * Document Writing Splitting Strategy
   */
  async splitDocumentWriting(input, options) {
    // Split by:
    // 1. Sections
    // 2. Word count targets
    // 3. Logical breaks

    const chunks = [];
    
    // Check if input specifies sections
    const sectionMatches = input.match(/(?:section|chapter|part)\s+\d+/gi);
    
    if (sectionMatches) {
      // Split by sections
      const sections = input.split(/(?=(?:section|chapter|part)\s+\d+)/gi);
      sections.forEach((section, i) => {
        if (section.trim()) {
          chunks.push({
            chunk_id: i + 1,
            input: section.trim(),
            type: 'section',
            context: `Section ${i + 1} of ${sections.length}`
          });
        }
      });
    } else {
      // Split by logical parts
      const parts = [
        { name: 'outline', prompt: 'Create a detailed outline for' },
        { name: 'introduction', prompt: 'Write the introduction for' },
        { name: 'body', prompt: 'Write the main body content for' },
        { name: 'conclusion', prompt: 'Write the conclusion for' }
      ];

      parts.forEach((part, i) => {
        chunks.push({
          chunk_id: i + 1,
          input: `${part.prompt}: ${input}`,
          type: 'part',
          context: `Part: ${part.name}`,
          depends_on: i > 0 ? i : null
        });
      });
    }

    return chunks;
  }

  /**
   * Research Splitting Strategy
   */
  async splitResearch(input, options) {
    // Split by:
    // 1. Research questions
    // 2. Sources
    // 3. Depth levels

    const chunks = [
      {
        chunk_id: 1,
        input: `Identify key research questions for: ${input}`,
        type: 'questions',
        context: 'Research planning'
      },
      {
        chunk_id: 2,
        input: `Find reliable sources and references for: ${input}`,
        type: 'sources',
        context: 'Source gathering'
      },
      {
        chunk_id: 3,
        input: `Analyze and synthesize information about: ${input}`,
        type: 'analysis',
        context: 'Deep analysis',
        depends_on: 2
      },
      {
        chunk_id: 4,
        input: `Create final summary and recommendations for: ${input}`,
        type: 'summary',
        context: 'Final synthesis',
        depends_on: 3
      }
    ];

    return chunks;
  }

  /**
   * Default Splitting Strategy - Naive chunking by size
   */
  async splitDefault(input, options) {
    const chunks = [];
    const maxChunkSize = this.optimalChunkSize * 4; // chars
    
    if (input.length <= maxChunkSize) {
      return [{ chunk_id: 1, input, type: 'full' }];
    }

    // Split by paragraphs first
    const paragraphs = input.split(/\n\n+/);
    let currentChunk = '';
    let chunkId = 1;

    for (const para of paragraphs) {
      if ((currentChunk + para).length > maxChunkSize && currentChunk) {
        chunks.push({
          chunk_id: chunkId++,
          input: currentChunk.trim(),
          type: 'part',
          context: `Part ${chunkId - 1}`
        });
        currentChunk = para;
      } else {
        currentChunk += (currentChunk ? '\n\n' : '') + para;
      }
    }

    if (currentChunk) {
      chunks.push({
        chunk_id: chunkId,
        input: currentChunk.trim(),
        type: 'part',
        context: `Part ${chunkId}`
      });
    }

    return chunks;
  }

  /**
   * Optimize LLM output to reduce tokens
   */
  optimizeOutput(output, options = {}) {
    const {
      max_tokens = 500,
      keep_structure = true,
      remove_redundancy = true,
      compress_lists = true
    } = options;

    let optimized = output;

    if (remove_redundancy) {
      // Remove redundant phrases
      optimized = this.removeRedundancy(optimized);
    }

    if (compress_lists) {
      // Compress verbose lists
      optimized = this.compressLists(optimized);
    }

    // Truncate if still too long
    const estimatedTokens = this.estimateTokens(optimized);
    if (estimatedTokens > max_tokens) {
      const ratio = max_tokens / estimatedTokens;
      const targetLength = Math.floor(optimized.length * ratio);
      optimized = this.intelligentTruncate(optimized, targetLength, keep_structure);
    }

    const saved = this.estimateTokens(output) - this.estimateTokens(optimized);
    
    return {
      original: output,
      optimized,
      original_tokens: this.estimateTokens(output),
      optimized_tokens: this.estimateTokens(optimized),
      tokens_saved: saved,
      compression_ratio: (saved / this.estimateTokens(output) * 100).toFixed(1) + '%'
    };
  }

  /**
   * Remove redundant phrases
   */
  removeRedundancy(text) {
    // Common redundant phrases
    const redundant = [
      /\bIn conclusion,?\b/gi,
      /\bTo sum up,?\b/gi,
      /\bAs mentioned (above|before|previously),?\b/gi,
      /\bIt is important to note that\b/gi,
      /\bIt should be noted that\b/gi,
      /\bBasically,?\b/gi,
      /\bEssentially,?\b/gi
    ];

    let result = text;
    redundant.forEach(pattern => {
      result = result.replace(pattern, '');
    });

    // Clean up multiple spaces
    result = result.replace(/\s+/g, ' ').trim();

    return result;
  }

  /**
   * Compress verbose lists
   */
  compressLists(text) {
    // Convert verbose bullet points to compact format
    let result = text;

    // "First, ... Second, ... Third, ..." → "1) ... 2) ... 3) ..."
    result = result.replace(/First,\s*/gi, '1) ');
    result = result.replace(/Second,\s*/gi, '2) ');
    result = result.replace(/Third,\s*/gi, '3) ');
    result = result.replace(/Fourth,\s*/gi, '4) ');

    return result;
  }

  /**
   * Intelligent truncation preserving structure
   */
  intelligentTruncate(text, targetLength, keepStructure) {
    if (text.length <= targetLength) return text;

    if (!keepStructure) {
      return text.substring(0, targetLength) + '...';
    }

    // Try to break at sentence boundaries
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let result = '';

    for (const sentence of sentences) {
      if ((result + sentence).length > targetLength) {
        break;
      }
      result += sentence;
    }

    return result.trim() || text.substring(0, targetLength) + '...';
  }

  /**
   * Execute chunked task with result aggregation
   */
  async executeChunkedTask(chunks, executor, options = {}) {
    const {
      parallel = false,
      max_parallel = 3,
      aggregate = true
    } = options;

    const results = [];

    if (parallel) {
      // Execute chunks in parallel (respect dependencies)
      const batchSize = max_parallel;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(chunk => executor(chunk))
        );
        results.push(...batchResults);
      }
    } else {
      // Execute sequentially
      for (const chunk of chunks) {
        const result = await executor(chunk);
        results.push(result);
      }
    }

    if (aggregate) {
      return this.aggregateResults(results, chunks);
    }

    return results;
  }

  /**
   * Aggregate chunk results into coherent output
   */
  aggregateResults(results, chunks) {
    // Determine aggregation strategy based on chunk types
    const chunkType = chunks[0]?.type;

    switch (chunkType) {
      case 'file':
      case 'concern':
        // Combine reviews with sections
        return results.map((r, i) => 
          `### ${chunks[i].context}\n\n${r}`
        ).join('\n\n---\n\n');

      case 'step':
        // Sequential steps
        return results.map((r, i) => 
          `**${chunks[i].context}:**\n${r}`
        ).join('\n\n');

      case 'part':
      case 'section':
        // Continuous document
        return results.join('\n\n');

      default:
        // Simple concatenation
        return results.join('\n\n');
    }
  }
}

// Singleton instance
const taskChunker = new TaskChunker();

module.exports = taskChunker;
