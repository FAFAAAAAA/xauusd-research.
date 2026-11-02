/* Decorative geometry only: the dashboard's text and values remain untouched. */
const FACES = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const;
const INGOTS = ['a', 'b', 'c'] as const;

export default function DimensionalScene() {
  return (
    <div className="d3-scene" aria-hidden="true">
      <div className="d3-glow" />
      <div className="d3-orbit orbit-a" />
      <div className="d3-orbit orbit-b" />
      <div className="d3-world">
        <div className="d3-plinth" />
        {INGOTS.map((ingot) => (
          <div className={`d3-ingot ingot-${ingot}`} key={ingot}>
            {FACES.map((face) => <i className={`d3-face face-${face}`} key={face} />)}
          </div>
        ))}
      </div>
      <span className="d3-spark spark-a" />
      <span className="d3-spark spark-b" />
    </div>
  );
}
