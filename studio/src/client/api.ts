import type {
  FinalRenderRequest,
  PreviewRequest,
  ProjectDetail,
  ProjectSummary,
  RenderJob,
  SaveDraftRequest,
} from '../shared/api.js';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    throw new Error(
      typeof body === 'object' && body && 'error' in body && body.error
        ? body.error
        : `Studio request failed with ${response.status}`,
    );
  }
  return body as T;
}

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const studioApi = {
  listProjects: async (): Promise<ProjectSummary[]> => await request('/api/projects'),
  project: async (id: string): Promise<ProjectDetail> =>
    await request(`/api/projects/${encodeURIComponent(id)}`),
  save: async (id: string, body: SaveDraftRequest): Promise<ProjectDetail> =>
    await request(`/api/projects/${encodeURIComponent(id)}/storyboard`, jsonInit('PUT', body)),
  preview: async (id: string, body: PreviewRequest): Promise<RenderJob> =>
    await request(`/api/projects/${encodeURIComponent(id)}/previews`, jsonInit('POST', body)),
  renderFinal: async (id: string, body: FinalRenderRequest): Promise<RenderJob> =>
    await request(`/api/projects/${encodeURIComponent(id)}/renders`, jsonInit('POST', body)),
  job: async (id: string): Promise<RenderJob> =>
    await request(`/api/jobs/${encodeURIComponent(id)}`),
};
