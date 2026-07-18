import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectGallery } from './ProjectGallery.js';

describe('ProjectGallery', () => {
  it('opens a listed edit and exposes its delivery status', () => {
    const onOpen = vi.fn();
    render(
      <ProjectGallery
        projects={[
          {
            id: 'city-edit',
            name: 'City Edit',
            durationSeconds: 20,
            aspect: '9:16',
            shotCount: 8,
            outputAvailable: true,
            qualityVerdict: 'technical-pass',
            warningCount: 0,
          },
        ]}
        loading={false}
        error={null}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText('Technical pass')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /open edit/i }));
    expect(onOpen).toHaveBeenCalledWith('city-edit');
  });
});
