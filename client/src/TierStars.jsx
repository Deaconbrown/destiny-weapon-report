const STAR_PATH = "M8 0.5l2.06 4.53 4.94.55-3.7 3.42.98 4.9L8 11.7 3.72 13.9l.98-4.9-3.7-3.42 4.94-.55z";

export default function TierStars({ count = 5, size = 12 }) {
  return (
    <div className="tier-stars" title={`Tier ${count}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 16 14">
          <path d={STAR_PATH} fill={i < count ? "#e8c34a" : "#3a3d45"} />
        </svg>
      ))}
    </div>
  );
}
