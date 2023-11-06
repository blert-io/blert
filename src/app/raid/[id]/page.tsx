type RaidParams = {
  id: string;
};

export default function Raid({ params }: { params: RaidParams }) {
  return (
    <div>raid {params.id}</div>
  );
}
