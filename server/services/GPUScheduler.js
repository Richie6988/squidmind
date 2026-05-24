const cron = require('node-cron');
const EventEmitter = require('events');

/**
 * GPU Scheduler - Advanced queue management for GPU/Model resources
 * 
 * Features:
 * - Priority queue (VIP > High > Normal > Low)
 * - GPU availability detection
 * - Automatic task scheduling via cron
 * - Resource pooling
 * - Fair allocation
 * - Agent wake-up system
 */
class GPUScheduler extends EventEmitter {
  constructor() {
    super();
    
    // Queue system (priority-based)
    this.queues = {
      vip: [],      // Critical tasks (fine-tuning, high-value agents)
      high: [],     // Important tasks (premium users)
      normal: [],   // Standard tasks
      low: []       // Background tasks
    };
    
    // GPU/Resource pool
    this.resources = {
      gpu: {
        total_vram: 0,        // Total VRAM in GB
        available_vram: 0,    // Available VRAM
        in_use: false,
        current_task: null,
        utilization: 0        // 0-100%
      },
      cpu: {
        cores: 0,
        available_cores: 0,
        utilization: 0
      }
    };
    
    // Active tasks
    this.activeTasks = new Map(); // taskId -> task
    
    // Cron jobs for scheduled wake-ups
    this.cronJobs = new Map(); // agentId -> cron job
    
    // Stats
    this.stats = {
      total_scheduled: 0,
      total_completed: 0,
      total_failed: 0,
      avg_wait_time_ms: 0,
      avg_execution_time_ms: 0
    };
    
    // Config
    this.config = {
      max_concurrent_tasks: 1,      // GPU tasks are usually sequential
      max_queue_size: 100,
      vip_weight: 10,               // Priority multipliers
      high_weight: 5,
      normal_weight: 1,
      low_weight: 0.5,
      fair_share_enabled: true,     // Prevent queue starvation
      auto_scale: true              // Auto-adjust based on load
    };
    
    // Start background processes
    this.startSchedulerLoop();
    this.startResourceMonitor();
  }

  /**
   * Initialize scheduler with GPU detection
   */
  async initialize() {
    console.log('🎯 Initializing GPU Scheduler...');
    
    // Detect GPU availability
    await this.detectGPU();
    
    // Detect CPU
    await this.detectCPU();
    
    console.log(`✅ GPU Scheduler ready`);
    console.log(`   GPU: ${this.resources.gpu.total_vram}GB VRAM`);
    console.log(`   CPU: ${this.resources.cpu.cores} cores`);
  }

  /**
   * Detect GPU and VRAM
   */
  async detectGPU() {
    try {
      // Try to detect NVIDIA GPU
      const { execSync } = require('child_process');
      
      try {
        const output = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', { encoding: 'utf8' });
        const vram = parseInt(output.trim());
        
        this.resources.gpu.total_vram = vram / 1024; // Convert MB to GB
        this.resources.gpu.available_vram = this.resources.gpu.total_vram;
        
        console.log(`🎮 NVIDIA GPU detected: ${this.resources.gpu.total_vram.toFixed(1)}GB VRAM`);
      } catch (e) {
        // No NVIDIA GPU, check for AMD/Intel
        console.log('ℹ️  No NVIDIA GPU detected, using CPU-only mode');
        this.resources.gpu.total_vram = 0;
        this.resources.gpu.available_vram = 0;
      }
    } catch (error) {
      console.log('ℹ️  GPU detection failed, using CPU-only mode');
    }
  }

  /**
   * Detect CPU cores
   */
  async detectCPU() {
    const os = require('os');
    this.resources.cpu.cores = os.cpus().length;
    this.resources.cpu.available_cores = this.resources.cpu.cores;
  }

  /**
   * Schedule a task (agent execution)
   */
  async scheduleTask(task) {
    const {
      agent_id,
      brain_id,
      input,
      priority = 'normal',  // vip, high, normal, low
      estimated_vram = 2,   // GB
      estimated_time = 60,  // seconds
      callback,
      wake_at = null        // ISO timestamp for scheduled wake
    } = task;

    // Validate queue size
    const totalQueued = Object.values(this.queues).reduce((sum, q) => sum + q.length, 0);
    if (totalQueued >= this.config.max_queue_size) {
      throw new Error('Queue is full. Please try again later.');
    }

    // Create task object
    const scheduledTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      agent_id,
      brain_id,
      input,
      priority,
      estimated_vram,
      estimated_time,
      callback,
      wake_at,
      queued_at: new Date(),
      started_at: null,
      completed_at: null,
      status: 'queued', // queued, scheduled, running, completed, failed
      result: null,
      error: null
    };

    // If wake_at is specified, schedule with cron
    if (wake_at) {
      this.scheduleWakeUp(scheduledTask);
    } else {
      // Add to appropriate queue
      this.queues[priority].push(scheduledTask);
      this.stats.total_scheduled++;
      
      console.log(`📋 Task queued: ${scheduledTask.id} (${priority} priority)`);
      this.emit('task_queued', scheduledTask);
    }

    return scheduledTask.id;
  }

  /**
   * Schedule a wake-up task with cron
   */
  scheduleWakeUp(task) {
    const wakeTime = new Date(task.wake_at);
    const now = new Date();
    
    if (wakeTime <= now) {
      // Wake time is in the past, queue immediately
      this.queues[task.priority].push(task);
      return;
    }

    // Create cron expression from wake time
    const cronExpr = this.dateToCron(wakeTime);
    
    console.log(`⏰ Scheduling wake-up for ${task.agent_id} at ${wakeTime.toISOString()}`);
    
    const job = cron.schedule(cronExpr, () => {
      console.log(`🔔 Wake-up triggered for ${task.agent_id}`);
      
      // Update task status
      task.status = 'scheduled';
      
      // Add to queue
      this.queues[task.priority].push(task);
      this.stats.total_scheduled++;
      
      // Stop cron job (one-time execution)
      job.stop();
      this.cronJobs.delete(task.agent_id);
      
      this.emit('agent_woken', task);
    });
    
    this.cronJobs.set(task.agent_id, job);
  }

  /**
   * Convert Date to cron expression
   */
  dateToCron(date) {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const day = date.getDate();
    const month = date.getMonth() + 1;
    
    return `${minute} ${hour} ${day} ${month} *`;
  }

  /**
   * Main scheduler loop - processes queue
   */
  startSchedulerLoop() {
    setInterval(async () => {
      await this.processQueue();
    }, 1000); // Check every second
  }

  /**
   * Process queue and execute tasks
   */
  async processQueue() {
    // Check if we can run more tasks
    if (this.activeTasks.size >= this.config.max_concurrent_tasks) {
      return; // Already at max capacity
    }

    // Get next task based on priority
    const nextTask = this.getNextTask();
    if (!nextTask) {
      return; // Queue is empty
    }

    // Check if we have enough resources
    if (!this.hasEnoughResources(nextTask)) {
      console.log(`⏳ Waiting for resources for task ${nextTask.id}`);
      return;
    }

    // Execute task
    await this.executeTask(nextTask);
  }

  /**
   * Get next task from queue (priority-based)
   */
  getNextTask() {
    // Try queues in priority order
    const priorities = ['vip', 'high', 'normal', 'low'];
    
    for (const priority of priorities) {
      if (this.queues[priority].length > 0) {
        // Fair share: if low priority queue is starving, give it a chance
        if (this.config.fair_share_enabled) {
          const lowQueueSize = this.queues.low.length;
          if (lowQueueSize > 10 && Math.random() < 0.2) {
            // 20% chance to pick from low queue if it's backed up
            return this.queues.low.shift();
          }
        }
        
        return this.queues[priority].shift();
      }
    }
    
    return null;
  }

  /**
   * Check if we have enough resources for task
   */
  hasEnoughResources(task) {
    // Check GPU VRAM
    if (task.estimated_vram > 0) {
      if (this.resources.gpu.available_vram < task.estimated_vram) {
        return false;
      }
    }
    
    // Check CPU cores
    const minCores = 2;
    if (this.resources.cpu.available_cores < minCores) {
      return false;
    }
    
    return true;
  }

  /**
   * Execute a task
   */
  async executeTask(task) {
    console.log(`🚀 Executing task ${task.id} for agent ${task.agent_id}`);
    
    // Update task status
    task.status = 'running';
    task.started_at = new Date();
    
    // Reserve resources
    this.reserveResources(task);
    
    // Add to active tasks
    this.activeTasks.set(task.id, task);
    
    // Emit event
    this.emit('task_started', task);
    
    try {
      // Execute callback (actual agent execution)
      if (task.callback && typeof task.callback === 'function') {
        const result = await task.callback();
        
        // Task completed successfully
        task.status = 'completed';
        task.completed_at = new Date();
        task.result = result;
        
        this.stats.total_completed++;
        
        console.log(`✅ Task ${task.id} completed`);
        this.emit('task_completed', task);
      }
    } catch (error) {
      // Task failed
      task.status = 'failed';
      task.completed_at = new Date();
      task.error = error.message;
      
      this.stats.total_failed++;
      
      console.error(`❌ Task ${task.id} failed:`, error);
      this.emit('task_failed', task);
    } finally {
      // Release resources
      this.releaseResources(task);
      
      // Remove from active tasks
      this.activeTasks.delete(task.id);
      
      // Update stats
      this.updateStats(task);
    }
  }

  /**
   * Reserve resources for task
   */
  reserveResources(task) {
    if (task.estimated_vram > 0) {
      this.resources.gpu.available_vram -= task.estimated_vram;
      this.resources.gpu.in_use = true;
      this.resources.gpu.current_task = task.id;
    }
    
    // Reserve CPU cores (estimate)
    const coresNeeded = Math.min(4, this.resources.cpu.available_cores);
    this.resources.cpu.available_cores -= coresNeeded;
  }

  /**
   * Release resources after task
   */
  releaseResources(task) {
    if (task.estimated_vram > 0) {
      this.resources.gpu.available_vram += task.estimated_vram;
      this.resources.gpu.in_use = false;
      this.resources.gpu.current_task = null;
    }
    
    // Release CPU cores
    const coresUsed = Math.min(4, this.resources.cpu.cores - this.resources.cpu.available_cores);
    this.resources.cpu.available_cores += coresUsed;
  }

  /**
   * Update statistics
   */
  updateStats(task) {
    const waitTime = task.started_at - task.queued_at;
    const execTime = task.completed_at - task.started_at;
    
    // Update averages
    const totalTasks = this.stats.total_completed + this.stats.total_failed;
    this.stats.avg_wait_time_ms = (this.stats.avg_wait_time_ms * (totalTasks - 1) + waitTime) / totalTasks;
    this.stats.avg_execution_time_ms = (this.stats.avg_execution_time_ms * (totalTasks - 1) + execTime) / totalTasks;
  }

  /**
   * Monitor resource usage
   */
  startResourceMonitor() {
    setInterval(() => {
      this.updateResourceMetrics();
    }, 5000); // Every 5 seconds
  }

  /**
   * Update resource metrics
   */
  async updateResourceMetrics() {
    const os = require('os');
    
    // CPU utilization
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    this.resources.cpu.utilization = Math.round(100 - (100 * totalIdle / totalTick));
    
    // GPU utilization (if available)
    if (this.resources.gpu.total_vram > 0) {
      try {
        const { execSync } = require('child_process');
        const output = execSync('nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits', { encoding: 'utf8' });
        this.resources.gpu.utilization = parseInt(output.trim());
      } catch (e) {
        // GPU metrics unavailable
      }
    }
  }

  /**
   * Get current queue status
   */
  getQueueStatus() {
    return {
      queues: {
        vip: this.queues.vip.length,
        high: this.queues.high.length,
        normal: this.queues.normal.length,
        low: this.queues.low.length
      },
      total_queued: Object.values(this.queues).reduce((sum, q) => sum + q.length, 0),
      active_tasks: this.activeTasks.size,
      scheduled_wakeups: this.cronJobs.size,
      resources: {
        gpu: {
          total_vram: this.resources.gpu.total_vram,
          available_vram: this.resources.gpu.available_vram,
          in_use: this.resources.gpu.in_use,
          utilization: this.resources.gpu.utilization
        },
        cpu: {
          total_cores: this.resources.cpu.cores,
          available_cores: this.resources.cpu.available_cores,
          utilization: this.resources.cpu.utilization
        }
      },
      stats: this.stats
    };
  }

  /**
   * Cancel a scheduled task
   */
  cancelTask(taskId) {
    // Check active tasks
    if (this.activeTasks.has(taskId)) {
      console.log(`⚠️  Cannot cancel running task ${taskId}`);
      return false;
    }
    
    // Check queues
    for (const priority in this.queues) {
      const index = this.queues[priority].findIndex(t => t.id === taskId);
      if (index !== -1) {
        this.queues[priority].splice(index, 1);
        console.log(`🗑️  Task ${taskId} cancelled`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get task status
   */
  getTaskStatus(taskId) {
    // Check active
    if (this.activeTasks.has(taskId)) {
      return this.activeTasks.get(taskId);
    }
    
    // Check queues
    for (const priority in this.queues) {
      const task = this.queues[priority].find(t => t.id === taskId);
      if (task) {
        return task;
      }
    }
    
    return null;
  }

  /**
   * Shutdown scheduler
   */
  async shutdown() {
    console.log('🛑 Shutting down GPU Scheduler...');
    
    // Stop all cron jobs
    for (const [agentId, job] of this.cronJobs.entries()) {
      job.stop();
    }
    this.cronJobs.clear();
    
    // Clear queues
    for (const priority in this.queues) {
      this.queues[priority] = [];
    }
    
    console.log('✅ GPU Scheduler shutdown complete');
  }
}

// Singleton instance
const gpuScheduler = new GPUScheduler();

module.exports = gpuScheduler;
