type SetupStrengthProps = {
  score: number | null | undefined
}

export default function SetupStrength({ score }: SetupStrengthProps) {
  if (score === null || score === undefined) return <span className="setup-strength unavailable" title="Сила сетапа недоступна для старого снимка"><b>—</b></span>

  return <span className={`setup-strength score-${score}`} title={`Сила сетапа: ${score} из 10`}>
    <b>{score}</b><small>/10</small><i><span style={{ width: `${score * 10}%` }} /></i>
  </span>
}
