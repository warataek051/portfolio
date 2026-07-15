import { useColorScheme } from 'react-native';

type ColorName = 'text' | 'background' | 'primary' | 'secondary' | 'border';
type ThemeProps = {
  light?: string;
  dark?: string;
};

const Colors = {
  light: {
    text: '#000',
    background: '#fff',
    primary: '#2f95dc',
    secondary: '#ccc',
    border: '#eee',
  },
  dark: {
    text: '#fff',
    background: '#000',
    primary: '#fff',
    secondary: '#333',
    border: '#222',
  },
};

export function useThemeColor(props: ThemeProps, colorName: ColorName) {
  const theme = useColorScheme() ?? 'light';
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  }
  return Colors[theme][colorName];
}
