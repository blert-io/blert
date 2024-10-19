import styles from './style.module.scss';

type TagListProps = {
  onRemove: (tag: string) => void;
  tags: string[];
  width?: number;
};

export default function TagList({ onRemove, tags, width }: TagListProps) {
  return (
    <div className={styles.tagList} style={{ width }}>
      {tags.map((tag) => (
        <div key={tag} className={styles.tag}>
          <span>{tag}</span>
          <button onClick={() => onRemove(tag)}>
            <i className="fas fa-times" />
          </button>
        </div>
      ))}
    </div>
  );
}
