import { COMMANDS } from '@/config/commands';

export class HelpGuide {
  constructor(
    private helpContainer: HTMLDivElement,
    private helpScreen: HTMLDivElement,
    private mainContent: HTMLDivElement,
    private buffer: HTMLDivElement
  ) {}

  public show(): void {
    this.helpContainer.innerHTML = '';
    this.helpScreen.innerHTML = '';

    // Create main container with responsive spacing
    const mainContainer = document.createElement('div');
    mainContainer.className = 'space-y-4 sm:space-y-6';

    // Mode Switching Box
    const modeBox = document.createElement('div');
    modeBox.className = 'bg-[#2c2c2c] p-4 rounded-lg border border-gray-700 shadow-lg';

    const modeLabel = document.createElement('h3');
    modeLabel.className = 'text-gray-400 text-xs font-medium mb-2';
    modeLabel.textContent = 'Mode Switching';

    const modeList = document.createElement('ul');
    modeList.className = 'space-y-2';
    
    const modes = [
      { key: 'e', desc: 'Switch to TX mode (requires connected wallet via :wc)' },
      { key: 'ESC', desc: 'Return to READ ONLY mode' }
    ];

    modes.forEach(({ key, desc }) => {
      const modeItem = document.createElement('li');
      modeItem.className = 'text-gray-300 text-xs flex items-center gap-2';
      modeItem.innerHTML = `
        <span class="text-blue-400 font-medium w-8">${key}</span>
        <span class="text-gray-400">${desc}</span>
      `;
      modeList.appendChild(modeItem);
    });

    modeBox.appendChild(modeLabel);
    modeBox.appendChild(modeList);
    mainContainer.appendChild(modeBox);

    // Commands Box
    const commandsBox = document.createElement('div');
    commandsBox.className = 'bg-[#2c2c2c] p-4 rounded-lg border border-gray-700 shadow-lg';

    const commandsLabel = document.createElement('h3');
    commandsLabel.className = 'text-gray-400 text-xs font-medium mb-2';
    commandsLabel.textContent = 'Commands';

    const commandsList = document.createElement('ul');
    commandsList.className = 'space-y-2';

    COMMANDS.forEach(({ cmd, desc }) => {
      const commandItem = document.createElement('li');
      commandItem.className = 'text-gray-300 text-xs flex items-center gap-2';
      commandItem.innerHTML = `
        <span class="text-blue-400 font-medium w-8">${cmd}</span>
        <span class="text-gray-400">${desc}</span>
      `;
      commandsList.appendChild(commandItem);
    });

    commandsBox.appendChild(commandsLabel);
    commandsBox.appendChild(commandsList);
    mainContainer.appendChild(commandsBox);

    this.showHelpContent(mainContainer);
  }

  private showHelpContent(mainContainer: HTMLDivElement): void {
    const inputContainer = document.getElementById('input-container');
    
    if (inputContainer) {
      // If input field is visible, show help in help-container
      this.helpContainer.appendChild(mainContainer);
      this.helpContainer.classList.remove('hidden');
      this.mainContent.classList.remove('hidden');
      this.buffer.classList.remove('hidden');
      this.helpScreen.classList.add('hidden');
      
      // Update help container classes
      this.helpContainer.className = 'w-full sm:w-1/2 p-4';
    } else {
      // If input field is not visible, show help in help-screen
      this.helpScreen.appendChild(mainContainer);
      this.helpScreen.classList.remove('hidden');
      this.mainContent.classList.add('hidden');
      this.buffer.classList.add('hidden');
    }
  }
} 