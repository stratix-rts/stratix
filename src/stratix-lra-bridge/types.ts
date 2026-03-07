export interface LraTask {
  id: string;
  description: string;
  template: string;
  priority: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'paused';
  parent_id: string | null;
  output_req: string;
  task_file: string;
  created_at: string;
  updated_at: string;
  dependencies: string[];
  dependency_type: string;
  deadline: string | null;
  lock_info?: {
    session_id: string;
    claimed_at: string;
    last_heartbeat: string;
  };
}

export interface LraTaskList {
  project_name: string;
  created_at: string;
  tasks: LraTask[];
}

export interface LraTaskDetail {
  id: string;
  status: string;
  priority: string;
  template: string;
  desc: string;
  output_req: string;
  parent_id: string | null;
  task_file: string;
  created_at: string;
  updated_at: string;
  lock_status?: string;
  lock_info?: {
    session_id: string;
    claimed_at: string;
    last_heartbeat: string;
  };
  available_transitions: string[];
}

export interface LraClaimResult {
  session_id: string;
  task_id: string;
  children_locked: number;
}
