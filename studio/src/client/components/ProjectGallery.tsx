import { AlertTriangle, Clapperboard, Clock3, Film, Play } from 'lucide-react';
import type { ProjectSummary } from '../../shared/api.js';
import { formatTime, humanize } from '../format.js';

interface ProjectGalleryProps {
  projects: ProjectSummary[];
  loading: boolean;
  error: string | null;
  onOpen: (id: string) => void;
}

export function ProjectGallery({ projects, loading, error, onOpen }: ProjectGalleryProps) {
  return (
    <main id="main-content" className="gallery-shell">
      <header className="gallery-header">
        <div>
          <p className="eyebrow">Local edit review</p>
          <h1>Video Creation Studio</h1>
          <p className="gallery-intro">
            Inspect the editorial logic, reshape the timeline, and render an exact FFmpeg preview
            before touching the final output.
          </p>
        </div>
        <div className="engine-pill">
          <span className="engine-dot" aria-hidden="true" />
          Local FFmpeg engine
        </div>
      </header>

      {loading ? (
        <div className="project-grid" aria-label="Loading projects">
          {[0, 1, 2].map((item) => (
            <div className="project-card skeleton-card" key={item} aria-hidden="true" />
          ))}
        </div>
      ) : error ? (
        <section className="empty-state" role="alert">
          <AlertTriangle aria-hidden="true" />
          <h2>Studio could not load the projects</h2>
          <p>{error}</p>
        </section>
      ) : projects.length === 0 ? (
        <section className="empty-state">
          <Clapperboard aria-hidden="true" />
          <h2>No storyboards found</h2>
          <p>Create a project with the existing CLI, then refresh this page.</p>
        </section>
      ) : (
        <section className="project-grid" aria-label="Available video projects">
          {projects.map((project, index) => (
            <article className="project-card" key={project.id}>
              <button className="project-poster" onClick={() => onOpen(project.id)}>
                {project.posterUrl ? (
                  <img src={project.posterUrl} alt="" />
                ) : (
                  <span className="poster-fallback" aria-hidden="true">
                    <Film />
                  </span>
                )}
                <span className="project-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="poster-play">
                  <Play fill="currentColor" aria-hidden="true" /> Open edit
                </span>
              </button>
              <div className="project-card-body">
                <div className="project-card-heading">
                  <div>
                    <h2>{project.name}</h2>
                    <p>{project.subtitle ?? humanize(project.id)}</p>
                  </div>
                  <span
                    className={`verdict-badge ${project.qualityVerdict === 'technical-pass' ? 'is-pass' : 'is-review'}`}
                  >
                    {project.qualityVerdict === 'technical-pass' ? 'Technical pass' : 'Review'}
                  </span>
                </div>
                <dl className="project-meta">
                  <div>
                    <dt>
                      <Clock3 aria-hidden="true" /> Duration
                    </dt>
                    <dd>{formatTime(project.durationSeconds)}</dd>
                  </div>
                  <div>
                    <dt>
                      <Clapperboard aria-hidden="true" /> Scenes
                    </dt>
                    <dd>{project.shotCount}</dd>
                  </div>
                  <div>
                    <dt>Format</dt>
                    <dd>{project.aspect}</dd>
                  </div>
                </dl>
                {project.warningCount > 0 ? (
                  <p className="warning-line">
                    <AlertTriangle aria-hidden="true" /> {project.warningCount} review warning
                    {project.warningCount === 1 ? '' : 's'}
                  </p>
                ) : (
                  <p className="quiet-line">No machine-detected delivery warnings</p>
                )}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
