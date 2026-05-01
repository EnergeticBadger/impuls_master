import { HeaderText } from "~/Components/HeaderText/HeaderText";

export function meta() {
  return [
    { title: "New React Router App" },
    { name: "description", content: "Welcome to React Router!" },
  ];
}

export default function Home() {
  return <HeaderText header="New React App"/>;
}
