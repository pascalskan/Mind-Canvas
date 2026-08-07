import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MindCanvas from './components/MindCanvas';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MindCanvas />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
