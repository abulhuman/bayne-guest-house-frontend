import { Video, VideoPlayer, VideoSkin } from '@videojs/react/video';
import '@videojs/react/video/skin.css';
import type { CSSProperties } from 'react';
import Modal from '@/components/Modal';
import type { Tutorial } from '@/lib/tutorials';

export default function PlayerModal({ tutorial, onClose }: { tutorial: Tutorial | null; onClose: () => void }) {
  return <Modal open={!!tutorial} onClose={onClose} title={tutorial?.title ?? 'Tutorial'} size="3xl">
    {tutorial && <div style={{ '--media-accent-color': '#1f6470' } as CSSProperties} className="overflow-hidden rounded-input bg-ink">
      <VideoPlayer><VideoSkin><Video src={tutorial.videoUrl} poster={tutorial.posterUrl} autoPlay /></VideoSkin></VideoPlayer>
      <p className="bg-ink px-4 py-3 text-sm text-surface">{tutorial.summary}</p>
    </div>}
  </Modal>;
}
